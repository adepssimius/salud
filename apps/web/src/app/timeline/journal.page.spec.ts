import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { JournalPage } from './journal.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

const patient = { id: 'p1', fullName: 'Jamie Doe' } as any;

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);

/** Midnight local time, so the day-grouping assertions don't depend on the hour the suite runs. */
function startOfLocalDay(epochSeconds: number): number {
  const d = new Date(epochSeconds * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

const today = now;
/** An hour before today's midnight is yesterday, whatever the clock says right now. */
const yesterday = startOfLocalDay(now) - HOUR;

const entry = (over: any) => ({
  recordedBy: { id: 'u1', displayName: 'Dana' },
  ...over,
});

const observation = entry({
  id: 'obs-1',
  kind: 'observation',
  type: 'temperature',
  timestamp: yesterday,
  recordedBy: { id: 'u2', displayName: 'Sam Nightshift' },
  display: {
    id: 'obs-1',
    observedAt: yesterday,
    createdAt: yesterday,
    entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
  },
});

const dose = entry({
  id: 'int-1',
  kind: 'intervention',
  type: 'medication_dose',
  timestamp: today,
  display: {
    id: 'int-1',
    type: 'medication_dose',
    performedAt: today,
    createdAt: today,
    metadata: { medicationId: 'm1', amountMg: 240, isAtypical: false },
  },
});

// Newest first, as the API returns them.
const timelineResponse = { patient, weightPrompt: { needsUpdate: false }, entries: [dose, observation] };

const medications = [{ id: 'm1', name: 'Ibuprofen', brandNames: ['Advil'], tags: ['fever'] }] as any;

// Started exactly two local midnights back, so "today" is day 3 and "yesterday" day 2 whatever
// hour the suite happens to run at.
const episodes = [
  {
    id: 'ep1',
    patientId: 'p1',
    name: 'Fever',
    status: 'active',
    startedAt: startOfLocalDay(now) - 2 * 24 * HOUR,
    endedAt: null,
  },
];

describe('JournalPage', () => {
  let apiMock: any;
  let routerMock: any;
  let whatsNew: any;

  beforeEach(async () => {
    // Between the two entries: yesterday's observation is already seen, today's dose is not.
    whatsNew = { since: yesterday + 60, events: [], advisoriesFired: [], nowDue: [] };
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/medications') return of(medications);
        if (path.endsWith('/episodes')) return of(episodes);
        if (path.endsWith('/whats-new')) return of(whatsNew);
        return of(timelineResponse);
      }),
      post: jest.fn(() => of({ ackedAt: now })),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [JournalPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(JournalPage);
    fixture.detectChanges();
    return fixture;
  }

  it('loads the timeline, medications, episodes and the watermark on init', () => {
    render();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', {});
    expect(apiMock.get).toHaveBeenCalledWith('/medications');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/episodes');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/whats-new');
  });

  // P3: attribution is the entire point of a multi-caregiver log.
  it('attributes every row by name and time, from the payload rather than a lookup', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Dana');
    expect(text).toContain('Sam Nightshift');
    // The names arrive on the entries; the page never fetches users to resolve them.
    expect(apiMock.get).not.toHaveBeenCalledWith('/users/search', expect.anything());
    const authors = Array.from(fixture.nativeElement.querySelectorAll('.feed-author')).map((el: any) =>
      el.textContent.trim(),
    );
    expect(authors).toEqual(['Dana', 'Sam Nightshift']);
  });

  it('names the medication on a dose line instead of the raw id', () => {
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('240 mg Ibuprofen');
    expect(fixture.nativeElement.textContent).not.toContain('m1');
  });

  it('groups the feed by day, newest day first', () => {
    const fixture = render();
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.feed-day-label')).map((el: any) =>
      el.textContent.trim(),
    );
    expect(labels[0]).toBe('Today');
    expect(labels.length).toBe(2);
  });

  it('renders an episode frame as a clickable feed divider, once per day it covers', () => {
    const fixture = render();
    const dividers = Array.from(fixture.nativeElement.querySelectorAll('.episode-divider')).map((el: any) =>
      el.textContent.trim(),
    );
    // Two days of rows inside one frame → one marker per day, each with that day's number.
    expect(dividers.length).toBe(2);
    expect(dividers[0]).toContain('Fever, day 3');
    expect(dividers[1]).toContain('Fever, day 2');

    fixture.nativeElement.querySelector('.episode-divider').dispatchEvent(new MouseEvent('click'));
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
  });

  it('links from the feed header to the photo progression view', () => {
    const fixture = render();
    const link = Array.from(fixture.nativeElement.querySelectorAll('.journal-feed-head .link')).find(
      (b: any) => /photos/i.test(b.textContent),
    ) as HTMLButtonElement;
    expect(link).toBeDefined();
    link.click();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'photos']);
  });

  it('marks concurrent episodes separately rather than naming only one', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes'))
        return of([
          ...episodes,
          { ...episodes[0], id: 'ep2', name: 'Eczema flare' },
        ]);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of(timelineResponse);
    });
    const fixture = render();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Fever, day 3');
    expect(text).toContain('Eczema flare, day 3');
  });

  it('renders no divider for rows outside every episode frame', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of([]);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of(timelineResponse);
    });
    const fixture = render();
    expect(fixture.nativeElement.querySelectorAll('.episode-divider').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.feed-row').length).toBe(2);
  });

  describe('the since-you-last-looked marker', () => {
    it('renders inside the feed, under the oldest entry logged since the watermark', () => {
      const fixture = render();
      expect(fixture.componentInstance.watermarkAfterEntryId()).toBe('int-1');
      expect(fixture.nativeElement.querySelector('.watermark').textContent).toContain('New since you last looked');
    });

    it('does not render when nothing has been logged since the watermark', () => {
      whatsNew = { ...whatsNew, since: now + 60 };
      const fixture = render();
      expect(fixture.componentInstance.watermarkAfterEntryId()).toBeNull();
      expect(fixture.nativeElement.querySelector('.watermark')).toBeNull();
    });

    // "Unseen" is decided on log time, not clinical time — a 2 AM entry written up at 6 AM is
    // unseen by whoever last looked at 5 AM (api.md → While You Were Asleep).
    it('decides unseen on log time, not the clinical timestamp', () => {
      const lateWriteUp = entry({
        id: 'obs-late',
        kind: 'observation',
        type: 'note',
        timestamp: yesterday - HOUR, // clinically the oldest row on the page
        display: {
          id: 'obs-late',
          observedAt: yesterday - HOUR,
          createdAt: now, // …but written up just now, after the watermark
          entries: [{ type: 'note', metadata: { text: 'wrote this up late' } }],
        },
      });
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/medications') return of(medications);
        if (path.endsWith('/episodes')) return of(episodes);
        if (path.endsWith('/whats-new')) return of(whatsNew);
        return of({ ...timelineResponse, entries: [dose, observation, lateWriteUp] });
      });

      const fixture = render();
      // The line drops below the late write-up, so reading down to it covers everything new.
      expect(fixture.componentInstance.watermarkAfterEntryId()).toBe('obs-late');
    });

    // The deliberate-ack rule (frontend.md → While You Were Asleep): a caregiver who opens the
    // journal, gets pulled away and closes the tab has not consumed the briefing.
    it('never acks from scrolling — only the button does', () => {
      const fixture = render();
      window.dispatchEvent(new Event('scroll'));
      fixture.nativeElement.querySelector('.journal').dispatchEvent(new Event('scroll', { bubbles: true }));
      fixture.detectChanges();
      expect(apiMock.post).not.toHaveBeenCalled();

      fixture.nativeElement.querySelector('.watermark-ack').dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();
      expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/whats-new/ack', {});
      expect(fixture.componentInstance.acked()).toBe(true);
      expect(fixture.nativeElement.querySelector('.watermark').textContent).toContain('Marked as seen');
    });

    it('surfaces a failed ack instead of claiming the briefing was seen', () => {
      apiMock.post.mockReturnValue(throwError(() => ({ status: 500 })));
      const fixture = render();
      fixture.componentInstance.markAsSeen();
      fixture.detectChanges();
      expect(fixture.componentInstance.acked()).toBe(false);
      expect(fixture.nativeElement.textContent).toContain('Could not mark as seen.');
    });

    it('still renders the feed when the watermark call fails', () => {
      apiMock.get.mockImplementation((path: string) => {
        if (path === '/medications') return of(medications);
        if (path.endsWith('/episodes')) return of(episodes);
        if (path.endsWith('/whats-new')) return throwError(() => ({ status: 500 }));
        return of(timelineResponse);
      });
      const fixture = render();
      expect(fixture.nativeElement.querySelector('.watermark')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Dana');
    });
  });

  describe('filters', () => {
    it('filterByMedication reloads with medicationId, driving chart and feed together', () => {
      const fixture = render();
      fixture.componentInstance.filterByMedication('m1');
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', { medicationId: 'm1' });
      // One response feeds both, so there is no second request to disagree with the first.
      expect(apiMock.get.mock.calls.filter((c: any[]) => c[0] === '/patients/p1/timeline').length).toBe(2);
    });

    it('filterByTag clears the medication filter and reloads', () => {
      const fixture = render();
      fixture.componentInstance.filterByTag('fever');
      expect(fixture.componentInstance.selectedMedicationId()).toBeNull();
      expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/timeline', { medicationTag: 'fever' });
    });

    it('keeps the filter chips reachable when the chart is collapsed', () => {
      const fixture = render();
      fixture.componentInstance.chartOpen.set(false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-journal-chart')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Ibuprofen');
      expect(fixture.nativeElement.textContent).toContain('Show chart');
    });
  });

  it('aggregates lab entries into one line rather than one row per analyte', () => {
    const labs = Array.from({ length: 30 }, (_, i) => ({
      type: 'lab_result',
      metadata: { analyte: `a${i}`, valueText: '1', flag: i === 0 ? 'L' : null },
    }));
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of(episodes);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of({
        ...timelineResponse,
        entries: [
          entry({
            id: 'obs-labs',
            kind: 'observation',
            type: 'lab_result',
            timestamp: today,
            display: { id: 'obs-labs', observedAt: today, createdAt: today, entries: labs },
          }),
        ],
      });
    });

    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Labs: 30 results, 1 low');
    expect(fixture.nativeElement.querySelectorAll('.feed-row').length).toBe(1);
  });

  it('renders document entries as attachment links, not as a text summary line', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of(episodes);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of({
        ...timelineResponse,
        entries: [
          entry({
            id: 'obs-doc',
            kind: 'observation',
            type: 'document',
            timestamp: today,
            display: {
              id: 'obs-doc',
              observedAt: today,
              createdAt: today,
              entries: [{ type: 'document', metadata: { fileId: 'f1', label: 'Discharge summary' } }],
            },
          }),
        ],
      });
    });

    const fixture = render();
    const link = fixture.nativeElement.querySelector('app-document-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Discharge summary');
    expect(fixture.nativeElement.querySelector('.feed-text').textContent).not.toContain('document ·');
  });

  it('labels an advisory row as system-fired rather than borrowing a caregiver name', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of(episodes);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of({
        ...timelineResponse,
        entries: [
          {
            id: 'adv-1',
            kind: 'advisory',
            type: 'protocol_fired',
            timestamp: today,
            recordedBy: null,
            display: { id: 'adv-1', type: 'protocol_fired', severity: 'warning', createdAt: today },
          },
        ],
      });
    });

    const fixture = render();
    expect(fixture.nativeElement.querySelector('.feed-author-system')).not.toBeNull();
  });

  it('shows the API error instead of an empty feed when the timeline fails', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of(episodes);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return throwError(() => ({ status: 500 }));
    });
    const fixture = render();
    expect(fixture.nativeElement.querySelector('.error').textContent).toContain('Unable to load the journal.');
  });

  // frontend.md → "Observation & intervention detail": the feed line is a summary; the metadata
  // behind it only fits on a page of its own.
  it('links each feed row through to that event detail page', () => {
    const fixture = render();
    const links = fixture.nativeElement.querySelectorAll('.feed-text-link');
    expect(links.length).toBe(2);
    // Newest first: today's dose, then yesterday's observation.
    links[0].click();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/interventions', 'int-1']);
    links[1].click();
    expect(routerMock.navigate).toHaveBeenLastCalledWith(['/observations', 'obs-1']);
  });

  it('leaves an advisory row unlinked — there is no advisory detail page', () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/medications') return of(medications);
      if (path.endsWith('/episodes')) return of(episodes);
      if (path.endsWith('/whats-new')) return of(whatsNew);
      return of({
        ...timelineResponse,
        entries: [
          {
            id: 'adv-1',
            kind: 'advisory',
            type: 'protocol_fired',
            timestamp: today,
            recordedBy: null,
            display: { id: 'adv-1', type: 'protocol_fired', severity: 'warning', createdAt: today },
          },
        ],
      });
    });
    const fixture = render();
    expect(fixture.nativeElement.querySelector('.feed-text-link')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feed-text')).not.toBeNull();
  });

  it('converts temperatures to the caregiver preferred unit in the feed too', () => {
    TestBed.overrideProvider(AuthService, {
      useValue: { user: () => ({ preferredTempUnit: 'F', preferredWeightUnit: 'kg', preferredLengthUnit: 'cm' }) },
    });
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('101.3 °F');
  });
});

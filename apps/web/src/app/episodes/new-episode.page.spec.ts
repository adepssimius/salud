import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { NewEpisodePage, byClinicalTime } from './new-episode.page';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';

const entry = (id: string, kind: 'observation' | 'intervention', timestamp: number) => ({
  id,
  kind,
  type: kind === 'observation' ? 'temperature' : 'dressing_change',
  timestamp,
  display:
    kind === 'observation'
      ? { entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }] }
      : { type: 'dressing_change', metadata: { bodyLocation: 'Left knee' } },
});

describe('NewEpisodePage', () => {
  let apiMock: any;
  let routerMock: any;
  let timelineEntries: any[];

  const build = () => {
    const fixture = TestBed.createComponent(NewEpisodePage);
    fixture.detectChanges();
    return fixture;
  };
  const boxes = (fixture: any) =>
    Array.from(fixture.nativeElement.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[];

  beforeEach(async () => {
    timelineEntries = [
      entry('obs-new', 'observation', 1700200000),
      entry('int-old', 'intervention', 1700000000),
      { id: 'adv', kind: 'advisory', type: 'protocol_fired', timestamp: 1700100000, display: { type: 'protocol_fired' } },
    ];
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/patients/p1/conditions') return of([{ id: 'c1', name: 'Eczema', status: 'active' }]);
        if (path === '/patients/p1/timeline')
          return of({ patient: { id: 'p1' }, entries: timelineEntries, weightPrompt: {} });
        return of([]);
      }),
      post: jest.fn(() => of({ id: 'ep9' })),
    };
    routerMock = { navigate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [NewEpisodePage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: { user: () => null } },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  it('lists the patient’s entries newest first, without advisories', () => {
    const fixture = build();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.pick')).map((r: any) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('observation');
    expect(rows[1]).toContain('intervention');
  });

  it('says to log something first when the patient has no entries', () => {
    timelineEntries = [];
    const fixture = build();
    expect(fixture.nativeElement.textContent).toContain('No entries logged for this patient yet');
  });

  it('names the earliest selected entry as the start and creates the episode', () => {
    const fixture = build();
    const comp = fixture.componentInstance;
    comp.name = 'Knee scrape';
    boxes(fixture).forEach((b) => b.click());
    fixture.detectChanges();

    expect(comp.start()?.id).toBe('int-old');
    expect(fixture.nativeElement.textContent).toContain('Starts with');

    comp.conditionId = 'c1';
    comp.submit();
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/episodes', {
      name: 'Knee scrape',
      conditionId: 'c1',
      notes: null,
      events: [
        { type: 'observation', id: 'obs-new' },
        { type: 'intervention', id: 'int-old' },
      ],
      resolvedBy: null,
    });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep9']);
  });

  it('ends the episode with the last selected entry when marked over', () => {
    const fixture = build();
    const comp = fixture.componentInstance;
    comp.name = 'Fever';
    boxes(fixture).forEach((b) => b.click());
    comp.over = true;
    comp.submit();
    expect(apiMock.post.mock.calls[0][1].resolvedBy).toEqual({ type: 'observation', id: 'obs-new' });
  });

  it('cannot save without a name and an entry, and shows the API error', () => {
    const fixture = build();
    const comp = fixture.componentInstance;
    expect(comp.canSave()).toBe(false);
    comp.name = 'X';
    expect(comp.canSave()).toBe(false);
    boxes(fixture)[0].click();
    expect(comp.canSave()).toBe(true);

    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'EPISODE_EVENT_NOT_FOUND' } })));
    comp.submit();
    expect(comp.error()).toContain('no longer available');
    expect(comp.saving()).toBe(false);
  });

  it('orders ties observation-first, then by id, as the API does', () => {
    const a = { type: 'intervention' as const, id: 'a', timestamp: 5, label: '' };
    const b = { type: 'observation' as const, id: 'z', timestamp: 5, label: '' };
    expect([a, b].sort(byClinicalTime)[0]).toBe(b);
  });
});

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ScheduleDetailPage } from './schedule-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const baseSchedule = {
  id: 's1',
  patientId: 'p1',
  type: 'medication_dose',
  medicationId: 'm1',
  medicationEmbodimentId: null,
  episodeId: null,
  label: 'Amoxicillin q8h',
  doseMg: 400,
  doseMl: null,
  pillCount: null,
  bodyLocation: null,
  side: null,
  dressingType: null,
  frequencyHours: 8,
  explicitTimes: null,
  startAt: 1700000000,
  endAfterOccurrences: 10,
  endAt: null,
  notes: null,
  status: 'active',
  nextDueAt: 1700028800,
  createdByUserId: 'u1',
  createdAt: 1700000000,
  updatedAt: 1700000000,
  adherence: { expectedCount: 2, loggedCount: 1, missed: 1, remainingOccurrences: 9, overdue: false },
};

const dose = (id: string, linkedLater: boolean, performedAt = 1700001000) => ({
  interventionId: id,
  performedAt,
  medicationEmbodimentId: null,
  amountMg: 400,
  amountMl: null,
  pillCount: null,
  doseSource: linkedLater ? 'override' : 'schedule',
  recordedByUserId: 'u1',
  linkedLater,
});

let queryParams: Record<string, string> = {};

describe('ScheduleDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of({ schedule: baseSchedule, linked: [], candidates: [] })),
      post: jest.fn(),
      patch: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ScheduleDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: new Map([['id', 's1']]),
              get queryParamMap() {
                return new Map(Object.entries(queryParams));
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('loads the schedule and renders adherence stats', () => {
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/schedules/s1/doses');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Amoxicillin q8h');
    expect(text).toContain('logged');
    expect(text).toContain('missed');
  });

  it('logNow posts to the log endpoint and updates the schedule from the response', () => {
    apiMock.post.mockReturnValue(
      of({ intervention: { id: 'int-1' }, schedule: { ...baseSchedule, adherence: { ...baseSchedule.adherence, loggedCount: 2 } } }),
    );
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.logNow();
    expect(apiMock.post).toHaveBeenCalledWith('/schedules/s1/log', {});
    expect(comp.logging()).toBe(false);
    // The schedule's doses list changed too, so the page re-reads it.
    expect(apiMock.get).toHaveBeenCalledTimes(2);
    expect(apiMock.get).toHaveBeenLastCalledWith('/schedules/s1/doses');
  });

  it('pause/resume/complete PATCH the correct status', () => {
    apiMock.patch.mockReturnValue(of({ ...baseSchedule, status: 'paused', nextDueAt: null }));
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.pause();
    expect(apiMock.patch).toHaveBeenCalledWith('/schedules/s1', { status: 'paused' });

    comp.resume();
    expect(apiMock.patch).toHaveBeenLastCalledWith('/schedules/s1', { status: 'active' });

    comp.complete();
    expect(apiMock.patch).toHaveBeenLastCalledWith('/schedules/s1', { status: 'completed' });
  });

  it('backToDashboard navigates to /dashboard', () => {
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    fixture.componentInstance.backToDashboard();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  describe('linking existing doses', () => {
    afterEach(() => (queryParams = {}));

    it('offers the unlinked doses, all preselected, and links the ones left ticked', () => {
      apiMock.get.mockReturnValue(of({ schedule: baseSchedule, linked: [], candidates: [dose('a', false), dose('b', false)] }));
      apiMock.post.mockReturnValue(
        of({ schedule: { ...baseSchedule, adherence: { ...baseSchedule.adherence, loggedCount: 1 } }, linked: [dose('a', true)], candidates: [dose('b', false)] }),
      );
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('2 doses of this medicine were logged without this schedule');
      const comp = fixture.componentInstance;
      comp.startLinking();
      fixture.detectChanges();
      expect([...comp.picked()]).toEqual(['a', 'b']);
      comp.togglePick('b');
      comp.linkPicked();
      expect(apiMock.post).toHaveBeenCalledWith('/schedules/s1/doses', { link: ['a'] });
      expect(comp.linking()).toBe(false);
      expect(comp.linked()[0].linkedLater).toBe(true);
    });

    it('opens the link list straight away when sent from the new-schedule form', () => {
      queryParams = { link: '1' };
      apiMock.get.mockReturnValue(of({ schedule: baseSchedule, linked: [], candidates: [dose('a', false)] }));
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      expect(fixture.componentInstance.linking()).toBe(true);
    });

    it('offers Unlink only on a dose linked later', () => {
      apiMock.get.mockReturnValue(of({ schedule: baseSchedule, linked: [dose('a', true), dose('b', false)], candidates: [] }));
      apiMock.post.mockReturnValue(of({ schedule: baseSchedule, linked: [dose('b', false)], candidates: [dose('a', false)] }));
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      const buttons = fixture.nativeElement.querySelectorAll('button.unlink');
      expect(buttons).toHaveLength(1);
      buttons[0].click();
      expect(apiMock.post).toHaveBeenCalledWith('/schedules/s1/doses', { unlink: ['a'] });
    });
  });
});

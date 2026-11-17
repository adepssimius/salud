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
  explicitTimes: null as string[] | null,
  timeZone: null as string | null,
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
    expect(apiMock.get.mock.calls.filter((c: any[]) => c[0] === '/schedules/s1/doses')).toHaveLength(2);
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

  it('names the stored zone beside fixed times only when it differs from the browser', () => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = browserZone === 'Pacific/Auckland' ? 'America/Chicago' : 'Pacific/Auckland';
    apiMock.get.mockReturnValue(
      of({ schedule: { ...baseSchedule, frequencyHours: null, explicitTimes: ['08:00', '20:00'], timeZone: other }, linked: [], candidates: [] }),
    );
    let fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(`${other} time`);

    apiMock.get.mockReturnValue(
      of({ schedule: { ...baseSchedule, frequencyHours: null, explicitTimes: ['08:00'], timeZone: browserZone }, linked: [], candidates: [] }),
    );
    fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(`${browserZone} time`);
    expect(fixture.nativeElement.textContent).not.toContain('Use my time zone');
  });

  it('offers to set the browser zone on a fixed-time schedule that has none, and PATCHes it', () => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const legacy = { ...baseSchedule, frequencyHours: null, explicitTimes: ['08:00'], timeZone: null };
    apiMock.get.mockReturnValue(of({ schedule: legacy, linked: [], candidates: [] }));
    apiMock.patch.mockReturnValue(of({ ...legacy, timeZone: browserZone }));
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("follow the server's clock");
    fixture.componentInstance.useMyTimeZone();
    expect(apiMock.patch).toHaveBeenCalledWith('/schedules/s1', { timeZone: browserZone });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Use my time zone');
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

  // frontend.md → Schedule detail → "Missed doses": the instruction repeated, the caregiver acts.
  describe('missed doses', () => {
    const missedSchedule = (missedDose: any, extra: any = {}) => ({
      ...baseSchedule,
      missedDoseAction: missedDose.action,
      missedDoseCutoffHours: null,
      missedDoseCourseEffect: null,
      missedDoseNote: 'per the label',
      missedDose,
      adherence: { ...baseSchedule.adherence, skippedCount: 0, overdue: true },
      ...extra,
    });
    const respond = (schedule: any, skips: any[] = []) =>
      apiMock.get.mockImplementation((path: string) =>
        path.endsWith('/skips') ? of(skips) : of({ schedule, linked: [], candidates: [] }),
      );

    it('states the instruction and offers to skip first when it says to skip', () => {
      respond(missedSchedule({ slotAt: 1700000000, nextSlotAt: 1700028800, action: 'skip', pastCutoff: false, doubleNextDue: false }));
      apiMock.post.mockReturnValue(of({}));
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('If a dose is missed:');
      expect(text).toContain('Skip it and give the next dose as usual');
      expect(text).toContain('“per the label”');
      expect(text).toContain('Skip this dose and give the next one as usual');
      const skipButton = Array.from(fixture.nativeElement.querySelectorAll('.missed-actions button') as NodeListOf<HTMLButtonElement>).find((b) =>
        b.textContent!.includes('Skip this dose'),
      )!;
      expect(skipButton.classList.contains('primary')).toBe(true);
      skipButton.click();
      expect(apiMock.post).toHaveBeenCalledWith('/schedules/s1/skips', {});
    });

    it('logs the prescribed double when take-two-next-time is in force', () => {
      respond(missedSchedule({ slotAt: 1700000000, nextSlotAt: 1700028800, action: 'double_next', pastCutoff: false, doubleNextDue: true }));
      apiMock.post.mockReturnValue(of({ intervention: {}, schedule: baseSchedule }));
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain("Don't give it now — give a double dose at the next dose");
      fixture.componentInstance.logDouble();
      expect(apiMock.post).toHaveBeenCalledWith('/schedules/s1/log', { double: true });
    });

    it('gives no advice without an instruction, and lists skips with Undo only for a tapped skip', () => {
      respond(missedSchedule({ slotAt: 1700000000, nextSlotAt: 1700028800, action: null, pastCutoff: false, doubleNextDue: false }, { missedDoseNote: null }), [
        { id: 'k1', scheduleId: 's1', slotAt: 1699971200, reason: 'skipped', recordedByUserId: 'u1', createdAt: 1 },
        { id: 'k2', scheduleId: 's1', slotAt: 1699942400, reason: 'made_up_by_double', recordedByUserId: 'u1', createdAt: 1 },
      ]);
      apiMock.delete = jest.fn(() => of(baseSchedule));
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).not.toContain('If a dose is missed:');
      expect(el.querySelector('.missed-advice')).toBeNull();
      expect(el.textContent).toContain('made up by a double dose');
      const undo = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter((b) => b.textContent!.trim() === 'Undo');
      expect(undo).toHaveLength(1);
      undo[0].click();
      expect(apiMock.delete).toHaveBeenCalledWith('/schedules/s1/skips/k1');
    });
  });

  // ── Editing and deleting (frontend.md → Schedule detail → "Editing" / "Deleting") ───────────
  describe('edit and delete', () => {
    const respond = (schedule: any, linked: any[], skips: any[] = []) =>
      apiMock.get.mockImplementation((path: string) =>
        path.endsWith('/skips') ? of(skips) : of({ schedule, linked, candidates: [] }),
      );

    it('Edit opens the form at /schedules/:id/edit', () => {
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      fixture.componentInstance.edit();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules', 's1', 'edit']);
    });

    it('the confirmation says the logged doses stay and the skips go, then deletes and returns to the episode', () => {
      respond({ ...baseSchedule, episodeId: 'e1' }, [dose('d1', false), dose('d2', true)], [{ id: 'k1', slotAt: 1700000000, reason: 'skipped' }]);
      apiMock.delete = jest.fn().mockReturnValue(of({ deleted: true, unlinkedDoseCount: 2, removedSkipCount: 1 }));
      const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();

      fixture.componentInstance.deleteSchedule();
      const message = confirm.mock.calls[0][0] as string;
      expect(message).toContain('Delete "Amoxicillin q8h"?');
      expect(message).toContain('2 logged doses stay in the journal and the care record');
      expect(message).toContain('1 skipped dose is removed');
      expect(message).toContain('Mark complete keeps it');
      expect(apiMock.delete).toHaveBeenCalledWith('/schedules/s1');
      expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'e1']);
      confirm.mockRestore();
    });

    it('does nothing when the confirmation is declined', () => {
      apiMock.delete = jest.fn();
      const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
      const fixture = TestBed.createComponent(ScheduleDetailPage);
      fixture.detectChanges();
      fixture.componentInstance.deleteSchedule();
      expect(confirm.mock.calls[0][0]).toContain('No doses are logged on this schedule.');
      expect(apiMock.delete).not.toHaveBeenCalled();
      confirm.mockRestore();
    });
  });
});

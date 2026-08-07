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

describe('ScheduleDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of(baseSchedule)),
      post: jest.fn(),
      patch: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ScheduleDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 's1']]) } } },
      ],
    }).compileComponents();
  });

  it('loads the schedule and renders adherence stats', () => {
    const fixture = TestBed.createComponent(ScheduleDetailPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/schedules/s1');
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
    expect(comp.schedule()?.adherence.loggedCount).toBe(2);
    expect(comp.logging()).toBe(false);
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
});

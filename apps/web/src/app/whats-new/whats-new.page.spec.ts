import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { WhatsNewPage } from './whats-new.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('WhatsNewPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = { get: jest.fn(), post: jest.fn() };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [WhatsNewPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  it('loads the briefing for the patient', () => {
    apiMock.get.mockReturnValue(
      of({
        since: 1700000000,
        events: [{ id: 'e1', kind: 'observation', type: 'temperature', timestamp: 1700000100, display: { entries: [{ type: 'temperature', metadata: { value: 38 } }] } }],
        advisoriesFired: [{ id: 'a1', patientId: 'p1', type: 'stale_weight', severity: 'warning', sourceType: null, sourceId: null, contextType: null, contextId: null, payload: {}, acknowledgedByUserId: 'u1', acknowledgedAt: 1700000000, createdAt: 1700000000, updatedAt: 1700000000 }],
        nowDue: [{ scheduleId: 's1', patientId: 'p1', label: 'Amoxicillin', type: 'medication_dose', episodeId: null, nextDueAt: 1700000000, overdue: true }],
      }),
    );
    const fixture = TestBed.createComponent(WhatsNewPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/whats-new');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Amoxicillin');
    expect(text).toContain('overdue');
  });

  it('shows a plain message when nothing changed', () => {
    apiMock.get.mockReturnValue(of({ since: 1700000000, events: [], advisoriesFired: [], nowDue: [] }));
    const fixture = TestBed.createComponent(WhatsNewPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing new since last time.');
  });

  it('shows an error when the briefing fails to load', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('fail')));
    const fixture = TestBed.createComponent(WhatsNewPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Unable to load the briefing.');
  });

  it('acks the briefing and disables the button', () => {
    apiMock.get.mockReturnValue(of({ since: 1700000000, events: [], advisoriesFired: [], nowDue: [] }));
    apiMock.post.mockReturnValue(of({ ackedAt: 1700001000 }));
    const fixture = TestBed.createComponent(WhatsNewPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.ack();
    expect(apiMock.post).toHaveBeenCalledWith('/patients/p1/whats-new/ack', {});
    expect(comp.acked()).toBe(true);

    apiMock.post.mockClear();
    comp.ack();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('backToDashboard navigates to the dashboard', () => {
    apiMock.get.mockReturnValue(of({ since: 1700000000, events: [], advisoriesFired: [], nowDue: [] }));
    const fixture = TestBed.createComponent(WhatsNewPage);
    fixture.detectChanges();
    fixture.componentInstance.backToDashboard();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});

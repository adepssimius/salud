import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConditionDetailPage } from './condition-detail.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const baseCondition = {
  id: 'c1',
  patientId: 'p1',
  name: 'ALL treatment',
  diagnosisText: 'Acute lymphoblastic leukemia',
  status: 'active',
  baselines: ['resting HR runs 110'],
  devices: ['port'],
  contacts: [{ name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' }],
  createdByUserId: 'u1',
  createdAt: 1700000000,
  updatedAt: 1700000000,
  episodeIds: ['ep1'],
  scheduleIds: ['sched1'],
  protocols: [
    {
      id: 'proto1',
      conditionId: 'c1',
      name: 'Fever with port',
      triggerMetric: 'temperature',
      triggerOperator: 'gte',
      triggerValue: 38,
      instructionText: 'ER immediately',
      sourceText: 'Dr. Okafor',
      active: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    },
  ],
};

describe('ConditionDetailPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn((path: string) => {
        if (path === '/conditions/c1') return of(baseCondition);
        if (path === '/schedules/sched1') {
          return of({
            id: 'sched1',
            patientId: 'p1',
            type: 'medication_dose',
            label: 'Insulin q12h',
            status: 'active',
            adherence: { expectedCount: 2, loggedCount: 1, missed: 1, remainingOccurrences: null, overdue: false },
          });
        }
        if (path === '/episodes/ep1') {
          return of({ id: 'ep1', patientId: 'p1', name: 'Neutropenic fever #3', status: 'active', startedAt: 1700000000 });
        }
        return of(null);
      }),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ConditionDetailPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'c1']]) } } },
      ],
    }).compileComponents();
  });

  it('loads the condition, its schedules, protocols, and episodes', async () => {
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.condition()?.name).toBe('ALL treatment');
    expect(comp.baselines()).toEqual(['resting HR runs 110']);
    expect(comp.protocols().length).toBe(1);
    expect(comp.schedules().length).toBe(1);
    expect(comp.schedules()[0].label).toBe('Insulin q12h');
    expect(comp.episodes().length).toBe(1);
    expect(comp.episodes()[0].name).toBe('Neutropenic fever #3');
  });

  it('saves condition edits via PATCH', () => {
    apiMock.patch.mockReturnValue(of({ ...baseCondition, name: 'ALL treatment (updated)' }));
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.patchValue({ name: 'ALL treatment (updated)' });
    comp.save();

    expect(apiMock.patch).toHaveBeenCalledWith(
      '/conditions/c1',
      expect.objectContaining({ name: 'ALL treatment (updated)' }),
    );
    expect(comp.condition()?.name).toBe('ALL treatment (updated)');
  });

  it('adds a protocol', () => {
    const newProtocol = {
      id: 'proto2',
      conditionId: 'c1',
      name: 'Low O2',
      triggerMetric: 'oxygen_saturation',
      triggerOperator: 'lte',
      triggerValue: 90,
      instructionText: 'Call oncology',
      sourceText: 'Dr. Okafor',
      active: true,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    };
    apiMock.post.mockReturnValue(of(newProtocol));
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.protocolForm.patchValue({
      name: 'Low O2',
      triggerMetric: 'oxygen_saturation',
      triggerOperator: 'lte',
      triggerValue: 90,
      instructionText: 'Call oncology',
      sourceText: 'Dr. Okafor',
    });
    comp.addProtocol();

    expect(apiMock.post).toHaveBeenCalledWith('/conditions/c1/protocols', expect.objectContaining({ name: 'Low O2' }));
    expect(comp.protocols().some((p) => p.id === 'proto2')).toBe(true);
  });

  it('toggles protocol active state', () => {
    apiMock.patch.mockReturnValue(of({ ...baseCondition.protocols[0], active: false }));
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.protocols.set([...baseCondition.protocols] as any);

    comp.toggleProtocolActive(comp.protocols()[0]);
    expect(apiMock.patch).toHaveBeenCalledWith('/protocols/proto1', { active: false });
  });

  it('navigates to a new standing schedule with conditionId prefilled', () => {
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.condition.set(baseCondition as any);

    comp.goToNewSchedule();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/schedules/new'], {
      queryParams: { conditionId: 'c1', patientId: 'p1' },
    });
  });

  it('backToPatient navigates to the patient detail page', () => {
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.condition.set(baseCondition as any);
    comp.backToPatient();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'history']);
  });

  it('goToEpisode navigates to the episode detail page for a nested episode', () => {
    const fixture = TestBed.createComponent(ConditionDetailPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.goToEpisode('ep1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/episodes', 'ep1']);
  });
});

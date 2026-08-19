import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NewConditionPage } from './new-condition.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

describe('NewConditionPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = { post: jest.fn() };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewConditionPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  it('builds baselines/devices/contacts lists and submits', () => {
    apiMock.post.mockReturnValue(of({ id: 'c1' }));
    const fixture = TestBed.createComponent(NewConditionPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.baselineDraft = 'resting HR runs 110';
    comp.addBaseline();
    comp.deviceDraft = 'port';
    comp.addDevice();
    comp.contactDraft = { name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' };
    comp.addContact();

    expect(comp.baselines()).toEqual(['resting HR runs 110']);
    expect(comp.devices()).toEqual(['port']);
    expect(comp.contacts()).toEqual([{ name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' }]);

    comp.form.patchValue({ name: 'ALL treatment' });
    comp.submit();

    expect(apiMock.post).toHaveBeenCalledWith(
      '/patients/p1/conditions',
      expect.objectContaining({
        name: 'ALL treatment',
        status: 'active',
        baselines: ['resting HR runs 110'],
        devices: ['port'],
        contacts: [{ name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' }],
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'history']);
  });

  it('removes list entries by index', () => {
    const fixture = TestBed.createComponent(NewConditionPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.baselineDraft = 'a';
    comp.addBaseline();
    comp.baselineDraft = 'b';
    comp.addBaseline();
    comp.removeBaseline(0);
    expect(comp.baselines()).toEqual(['b']);
  });

  it('falls back to a generic message when the error is not a recognized code', () => {
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'oops' } })));
    const fixture = TestBed.createComponent(NewConditionPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ name: 'ALL treatment' });
    comp.submit();
    expect(comp.error()).toBe('Could not create condition.');
  });

  it('cancel navigates back to the patient', () => {
    const fixture = TestBed.createComponent(NewConditionPage);
    fixture.detectChanges();
    fixture.componentInstance.cancel();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'history']);
  });
});

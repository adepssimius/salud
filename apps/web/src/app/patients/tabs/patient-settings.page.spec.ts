import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { PatientSettingsPage } from './patient-settings.page';
import { PatientHubStore } from '../patient-hub.store';
import { AuthService } from '../../core/auth.service';
import { ApiClientService } from '../../core/api-client.service';

const patient: any = {
  id: 'p1',
  fullName: 'Jamie Doe',
  dateOfBirth: '2015-04-02',
  sexAtBirth: 'female',
  notes: 'note',
  ownedById: 'u1',
  accentColor: 'teal',
  latestWeightKg: 20,
  latestWeightRecordedAt: null,
  myRole: 'parent',
  codeStatus: null,
  codeStatusSetByUserId: null,
  codeStatusSetAt: null,
};

describe('PatientSettingsPage', () => {
  let apiMock: any;
  let authMock: any;
  let routerMock: any;
  let store: PatientHubStore;

  const build = (patientOverride: any = patient) => {
    store = TestBed.inject(PatientHubStore);
    store.patientId.set('p1');
    store.patient.set(patientOverride);
    const fixture = TestBed.createComponent(PatientSettingsPage);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of([])),
      patch: jest.fn(),
      delete: jest.fn(),
    };
    authMock = {
      token: 'token',
      user: jest.fn().mockReturnValue({ id: 'u1', displayName: 'Tester', email: 't@example.com' }),
      me: jest.fn(),
      logout: jest.fn(),
    };
    routerMock = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PatientSettingsPage],
      providers: [
        PatientHubStore,
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('fills the form from the hub store without refetching the patient', () => {
    const fixture = build();
    expect(fixture.componentInstance.form.getRawValue().fullName).toBe('Jamie Doe');
    // The shell already fetched it; a second GET here would be the duplication the store exists
    // to prevent.
    expect(apiMock.get).not.toHaveBeenCalledWith('/patients/p1');
  });

  it('offers every palette token by name, not by color alone', () => {
    const fixture = build();
    const swatches = fixture.nativeElement.querySelectorAll('.swatch');
    expect(swatches.length).toBe(8);
    // A disc has no accessible name and says nothing to a color-blind caregiver; the word does.
    expect(swatches[0].textContent).toContain('Teal');
    // These sit inside the form whose submit saves — a default-type button would PATCH on click.
    expect(swatches[0].getAttribute('type')).toBe('button');
  });

  it('shows the stored color as the pressed swatch', () => {
    const fixture = build({ ...patient, accentColor: 'violet' });
    expect(fixture.componentInstance.form.getRawValue().accentColor).toBe('violet');
    const pressed = fixture.nativeElement.querySelectorAll('.swatch[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect(pressed[0].classList).toContain('accent-violet');
  });

  it('marks the form dirty when a swatch is clicked, so Save is a real edit', () => {
    const fixture = build();
    const swatch = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('.swatch'),
    ).find((b) => b.textContent?.includes('Rose'))!;
    swatch.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.form.getRawValue().accentColor).toBe('rose');
    expect(fixture.componentInstance.form.pristine).toBe(false);
    expect(swatch.getAttribute('aria-pressed')).toBe('true');
  });

  it('sends the chosen token on save and repaints the hub through the store', () => {
    apiMock.patch.mockReturnValue(of({ ...patient, accentColor: 'rose' }));
    const fixture = build();
    const component = fixture.componentInstance;
    component.selectAccent('rose');
    component.savePatient();
    expect(apiMock.patch).toHaveBeenCalledWith(
      '/patients/p1',
      expect.objectContaining({ accentColor: 'rose' }),
    );
    // The hub header reads store.patient()?.accentColor — this is what recolors the rail.
    expect(store.patient()?.accentColor).toBe('rose');
  });

  it('keeps an unsaved pick when the hub refetches the patient', () => {
    // The pristine guard is the only thing between a background reload and a lost edit.
    const fixture = build();
    fixture.componentInstance.selectAccent('lime');
    store.patient.set({ ...patient, fullName: 'Jamie Doe' });
    fixture.detectChanges();
    expect(fixture.componentInstance.form.getRawValue().accentColor).toBe('lime');
  });

  it('omits the color entirely when the patient carries none', () => {
    // A legacy payload without the field must not turn into accentColor: '' — the API 400s that.
    const { accentColor: _omitted, ...noColor } = patient;
    apiMock.patch.mockReturnValue(of(patient));
    const fixture = build(noColor);
    fixture.componentInstance.savePatient();
    expect(apiMock.patch.mock.calls[0][1]).not.toHaveProperty('accentColor');
  });

  it('saves edits and pushes the result back into the store', () => {
    apiMock.patch.mockReturnValue(of({ ...patient, fullName: 'Jamie Renamed' }));
    const fixture = build();
    const component = fixture.componentInstance;
    component.form.patchValue({ fullName: 'Jamie Renamed' });
    component.savePatient();
    expect(apiMock.patch).toHaveBeenCalledWith('/patients/p1', expect.objectContaining({ fullName: 'Jamie Renamed' }));
    // Pushed to the store so the hub header renames at the same moment.
    expect(store.patient()?.fullName).toBe('Jamie Renamed');
    expect(component.saveMessage()).toBe('Saved');
  });

  it('writes code status through its own endpoint', () => {
    apiMock.patch.mockReturnValue(of({ ...patient, codeStatus: 'Full code' }));
    const fixture = build();
    const component = fixture.componentInstance;
    component.startEditCodeStatus();
    component.codeStatusDraft = 'Full code';
    component.saveCodeStatus();
    expect(apiMock.patch).toHaveBeenCalledWith('/patients/p1/code-status', { codeStatus: 'Full code' });
    expect(component.editingCodeStatus()).toBe(false);
  });

  it('names who set the code status from the hub-loaded care team', () => {
    // Attribution (P3) has to hold here even though the care team is rendered on the Share tab —
    // that is exactly why the hub loads it once instead of each tab fetching its own.
    const fixture = build({ ...patient, codeStatusSetByUserId: 'u2', codeStatusSetAt: 1700000000 });
    store.careTeam.set([{ user: { id: 'u2', email: 'dana@example.com', displayName: 'Dana' }, role: 'parent' } as any]);
    fixture.detectChanges();
    expect(fixture.componentInstance.codeStatusSetByName()).toBe('Dana');
    expect(fixture.componentInstance.codeStatusAge()).not.toBe('');
  });

  it('falls back to a neutral word when the setter has left the care team', () => {
    const fixture = build({ ...patient, codeStatusSetByUserId: 'gone', codeStatusSetAt: 1700000000 });
    expect(fixture.componentInstance.codeStatusSetByName()).toBe('someone');
  });

  it('deletes and returns to the patient list', () => {
    apiMock.delete.mockReturnValue(of({ deleted: true }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = build();
    fixture.componentInstance.deletePatient();
    expect(apiMock.delete).toHaveBeenCalledWith('/patients/p1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients']);
  });

  it('hides delete from a non-owner and refuses the call', () => {
    const fixture = build({ ...patient, ownedById: 'someone-else' });
    expect(fixture.nativeElement.querySelector('button.danger')).toBeNull();
    fixture.componentInstance.deletePatient();
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  it('reports a failed delete without clobbering other messages', () => {
    apiMock.delete.mockReturnValue(throwError(() => ({ error: { message: 'boom' } })));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = build();
    const component = fixture.componentInstance;
    component.deletePatient();
    expect(component.deleteError()).toBe('Could not delete this patient.');
    expect(component.deleting()).toBe(false);
  });
});

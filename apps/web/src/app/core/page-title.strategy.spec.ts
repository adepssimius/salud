import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import {
  Routes,
  RouterOutlet,
  TitleStrategy,
  provideRouter,
  withRouterConfig,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { ApiClientService } from './api-client.service';
import {
  SaludTitleStrategy,
  composePageTitle,
  titleName,
} from './page-title.strategy';
import { PatientNameStore } from './patient-name.store';

@Component({ standalone: true, template: '' })
class LeafPage {}

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
})
class ShellPage {}

const routes: Routes = [
  { path: 'medications', component: LeafPage, title: 'Medications' },
  { path: 'bare', component: LeafPage },
  {
    path: 'patients/:id',
    component: ShellPage,
    data: { patientTitle: true },
    children: [{ path: 'journal', component: LeafPage, title: 'Journal' }],
  },
  // Same `:id` param name, but not a patient — the flag is what tells them apart.
  { path: 'episodes/:id', component: LeafPage, title: 'Episode' },
];

describe('composePageTitle', () => {
  it('leads with the patient, then the page, then the app', () => {
    expect(composePageTitle('Ada', 'Journal')).toBe('Ada · Journal · Salud');
  });

  it('drops the empty parts rather than leaving stray separators', () => {
    expect(composePageTitle(null, 'Medications')).toBe('Medications · Salud');
    expect(composePageTitle('Ada', null)).toBe('Ada · Salud');
    expect(composePageTitle(null, null)).toBe('Salud');
  });
});

describe('titleName', () => {
  it('uses the first name, which is what survives tab truncation', () => {
    expect(titleName('Ada Lovelace')).toBe('Ada');
  });

  it('handles a single-word name and extra whitespace', () => {
    expect(titleName('  Ada  ')).toBe('Ada');
  });

  it('returns null for a missing name', () => {
    expect(titleName(null)).toBeNull();
    expect(titleName('')).toBeNull();
  });
});

describe('SaludTitleStrategy', () => {
  let apiMock: { get: jest.Mock };
  let title: Title;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    apiMock = { get: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          routes,
          withRouterConfig({ paramsInheritanceStrategy: 'always' })
        ),
        { provide: ApiClientService, useValue: apiMock },
        { provide: TitleStrategy, useExisting: SaludTitleStrategy },
      ],
    });
    title = TestBed.inject(Title);
    harness = await RouterTestingHarness.create();
  });

  it('titles a page with no patient', async () => {
    await harness.navigateByUrl('/medications');
    expect(title.getTitle()).toBe('Medications · Salud');
  });

  it('falls back to the app name when a route declares no title', async () => {
    await harness.navigateByUrl('/bare');
    expect(title.getTitle()).toBe('Salud');
  });

  it('uses a name already cached without issuing a request', async () => {
    TestBed.inject(PatientNameStore).remember({
      id: 'p1',
      fullName: 'Ada Lovelace',
    });
    await harness.navigateByUrl('/patients/p1/journal');
    expect(title.getTitle()).toBe('Ada · Journal · Salud');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('fetches an unknown patient and upgrades the title when it lands', async () => {
    apiMock.get.mockReturnValue(of({ id: 'p1', fullName: 'Ada Lovelace' }));
    await harness.navigateByUrl('/patients/p1/journal');
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1');
    expect(title.getTitle()).toBe('Ada · Journal · Salud');
  });

  it('keeps the page title when the patient cannot be read', async () => {
    apiMock.get.mockReturnValue(
      throwError(() => new Error('PATIENT_NOT_FOUND'))
    );
    await harness.navigateByUrl('/patients/p1/journal');
    expect(title.getTitle()).toBe('Journal · Salud');
  });

  it("does not mistake another route's :id for a patient", async () => {
    await harness.navigateByUrl('/episodes/e1');
    expect(title.getTitle()).toBe('Episode · Salud');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('drops the patient again when navigating away', async () => {
    TestBed.inject(PatientNameStore).remember({
      id: 'p1',
      fullName: 'Ada Lovelace',
    });
    await harness.navigateByUrl('/patients/p1/journal');
    await harness.navigateByUrl('/medications');
    expect(title.getTitle()).toBe('Medications · Salud');
  });
});

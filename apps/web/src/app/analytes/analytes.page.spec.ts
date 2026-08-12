import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AnalytesPage } from './analytes.page';
import { ApiClientService } from '../core/api-client.service';
import { Router } from '@angular/router';

const FERRITIN = {
  id: 'a1',
  name: 'FERRITIN',
  displayName: 'Ferritin',
  unit: 'ng/mL',
  panel: 'IRON AND TOTAL IRON BINDING CAPACITY',
  createdAt: 1700000000,
  updatedAt: 1700000000,
};

describe('AnalytesPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = { get: jest.fn(), post: jest.fn() };
    routerMock = { navigate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [AnalytesPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('lists analytes by display name, showing the printed name when it differs', () => {
    apiMock.get.mockReturnValue(of([FERRITIN]));
    const fixture = TestBed.createComponent(AnalytesPage);
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/analytes', undefined);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ferritin');
    expect(text).toContain('as printed: FERRITIN');
    expect(text).toContain('ng/mL');
    // The panel is what makes a name like "% Saturation" mean something on its own row.
    expect(text).toContain('IRON AND TOTAL IRON BINDING CAPACITY');
  });

  it('explains an empty catalog rather than showing nothing', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(AnalytesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('import a lab report');
  });

  it('searches as you type', () => {
    apiMock.get.mockReturnValue(of([FERRITIN]));
    const fixture = TestBed.createComponent(AnalytesPage);
    fixture.detectChanges();
    fixture.componentInstance.onQueryChange({ target: { value: 'ferr' } } as any);
    expect(apiMock.get).toHaveBeenLastCalledWith('/analytes', { q: 'ferr' });
  });

  it('maps a duplicate-name conflict to its sentence', () => {
    apiMock.get.mockReturnValue(of([]));
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'ANALYTE_NAME_TAKEN' } })));
    const fixture = TestBed.createComponent(AnalytesPage);
    fixture.detectChanges();
    fixture.componentInstance.newForm.setValue({ name: 'FERRITIN', displayName: '', unit: '', panel: '' });
    fixture.componentInstance.createAnalyte();
    expect(fixture.componentInstance.error()).toContain('already in the catalog');
  });

  it('says so when the catalog cannot be loaded', () => {
    apiMock.get.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(AnalytesPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.loadError()).toBe('Could not load the analyte catalog.');
  });
});

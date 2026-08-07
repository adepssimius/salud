import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MedicationsPage } from './medications.page';
import { ApiClientService } from '../core/api-client.service';
import { Router } from '@angular/router';

describe('MedicationsPage', () => {
  let apiMock: any;
  let routerMock: any;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn().mockReturnValue(of([])),
      post: jest.fn(),
    };
    routerMock = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [MedicationsPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();
  });

  it('loads the medication list on init', () => {
    apiMock.get.mockReturnValue(
      of([
        { id: 'm1', name: 'acetaminophen', brandNames: ['Tylenol'], description: null, tags: ['antipyretic'], defaultActive: true, createdAt: 0, updatedAt: 0 },
      ]),
    );
    const fixture = TestBed.createComponent(MedicationsPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.medications().length).toBe(1);
    expect(apiMock.get).toHaveBeenCalledWith('/medications', undefined);
  });

  it('re-queries with q on search input', () => {
    const fixture = TestBed.createComponent(MedicationsPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.onQueryChange({ target: { value: 'tylenol' } } as unknown as Event);
    expect(comp.query()).toBe('tylenol');
    expect(apiMock.get).toHaveBeenLastCalledWith('/medications', { q: 'tylenol' });
  });

  it('navigates to detail page', () => {
    const fixture = TestBed.createComponent(MedicationsPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.goToDetail('m1');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/medications', 'm1']);
  });

  it('creates a medication and reloads the list', () => {
    apiMock.post.mockReturnValue(of({ id: 'm2' }));
    const fixture = TestBed.createComponent(MedicationsPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.newForm.setValue({ name: 'ibuprofen', brandNames: 'Motrin, Advil', tags: 'NSAID' });
    comp.createMedication();
    expect(apiMock.post).toHaveBeenCalledWith('/medications', {
      name: 'ibuprofen',
      brandNames: ['Motrin', 'Advil'],
      tags: ['NSAID'],
    });
    expect(comp.showNewForm()).toBe(false);
  });

  it('shows an error and clears the spinner when creating a medication fails', () => {
    // This save used to fail completely silently — no message, no cleared spinner.
    apiMock.post.mockReturnValue(throwError(() => ({ error: { message: 'boom' } })));
    const fixture = TestBed.createComponent(MedicationsPage);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.newForm.setValue({ name: 'ibuprofen', brandNames: '', tags: '' });
    comp.createMedication();
    expect(comp.error()).toBe('Could not add the medication.');
    expect(comp.saving()).toBe(false);
  });
});

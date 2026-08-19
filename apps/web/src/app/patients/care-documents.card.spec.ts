import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CareDocumentsMap } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { CareDocumentsCardComponent } from './care-documents.card';

const EMPTY: CareDocumentsMap = { livingWill: null, advanceDirective: null, medicalPoa: null };

describe('CareDocumentsCardComponent', () => {
  let apiMock: any;
  let confirmSpy: jest.SpyInstance;

  beforeEach(async () => {
    apiMock = {
      get: jest.fn((path: string) =>
        path.endsWith('/files') ? of([{ id: 'f9', originalName: 'old.pdf' }]) : of(EMPTY),
      ),
      put: jest.fn(() => of(EMPTY)),
      post: jest.fn(() => of({ fileId: 'new-file', url: '/api/files/new-file' })),
      getBlob: jest.fn(() => of(new Blob())),
    };
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [CareDocumentsCardComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => confirmSpy.mockRestore());

  function render() {
    const fixture = TestBed.createComponent(CareDocumentsCardComponent);
    fixture.componentInstance.patientId = 'p1';
    fixture.detectChanges();
    return fixture;
  }

  it('renders all three kinds, each as "Not recorded" before anything is stated', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Living will');
    expect(text).toContain('Advance directive');
    expect(text).toContain('Medical POA');
    expect(text.match(/Not recorded/g)?.length).toBe(3);
  });

  it('resolves the tri-state from the map, not from truthiness', () => {
    const fixture = render();
    fixture.componentInstance.documents.set({
      livingWill: null,
      advanceDirective: {
        id: 'a', kind: 'advance_directive', status: 'none', fileId: null, originalName: null,
        contentType: null, holderName: null, holderPhone: null, setByUserId: 'u1',
        setByName: 'Dana', setAt: 1700000000,
      },
      medicalPoa: null,
    });
    expect(fixture.componentInstance.statusOf('livingWill')).toBe('not_recorded');
    expect(fixture.componentInstance.statusOf('advanceDirective')).toBe('none');
  });

  /**
   * The safety rule from frontend.md: the ER Brief shows "none" to triage as a statement from the
   * family, so it must be impossible to record by accident. If this ever stops confirming, the
   * tri-state has quietly become a two-state.
   */
  it('confirms before recording "none", and does not write when the caregiver backs out', () => {
    const fixture = render();
    confirmSpy.mockReturnValue(false);
    fixture.componentInstance.recordNone('living_will');
    expect(apiMock.put).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fixture.componentInstance.recordNone('living_will');
    expect(apiMock.put).toHaveBeenCalledWith('/patients/p1/care-documents/living_will', {
      status: 'none',
    });
  });

  it('uploads a file and immediately records it as on file', () => {
    const fixture = render();
    const file = new File(['%PDF'], 'directive.pdf', { type: 'application/pdf' });
    const input = { files: [file], value: 'x' } as unknown as HTMLInputElement;
    fixture.componentInstance.uploadFor('advance_directive', { target: input } as unknown as Event);

    expect(apiMock.post).toHaveBeenCalledWith('/files', expect.any(FormData));
    expect(apiMock.put).toHaveBeenCalledWith('/patients/p1/care-documents/advance_directive', {
      status: 'on_file',
      fileId: 'new-file',
    });
  });

  it('attaches an already-uploaded file without re-uploading it', () => {
    const fixture = render();
    fixture.componentInstance.startAttach('living_will');
    fixture.componentInstance.attachFileId = 'f9';
    fixture.componentInstance.attach('living_will');

    expect(apiMock.post).not.toHaveBeenCalled();
    expect(apiMock.put).toHaveBeenCalledWith('/patients/p1/care-documents/living_will', {
      status: 'on_file',
      fileId: 'f9',
    });
  });

  it('sends holder details only on the PoA kind', () => {
    const fixture = render();
    fixture.componentInstance.holderName = 'Aunt Ada';
    fixture.componentInstance.holderPhone = '555-0100';

    fixture.componentInstance.recordNone('medical_poa');
    expect(apiMock.put).toHaveBeenLastCalledWith('/patients/p1/care-documents/medical_poa', {
      status: 'none',
      holderName: 'Aunt Ada',
      holderPhone: '555-0100',
    });

    fixture.componentInstance.recordNone('living_will');
    expect(apiMock.put).toHaveBeenLastCalledWith('/patients/p1/care-documents/living_will', {
      status: 'none',
    });
  });

  it('surfaces a save failure rather than failing silently', () => {
    const fixture = render();
    apiMock.put.mockReturnValue(throwError(() => ({ error: { message: 'CARE_DOCUMENT_FILE_NOT_FOUND' } })));
    fixture.componentInstance.recordNone('living_will');
    fixture.detectChanges();

    expect(fixture.componentInstance.rowError()).toContain('could not be attached');
    expect(fixture.componentInstance.busy()).toBeNull();
  });

  it('says so when the card itself cannot load', () => {
    apiMock.get.mockImplementation((path: string) =>
      path.endsWith('/files') ? of([]) : throwError(() => ({ status: 500 })),
    );
    const fixture = render();
    expect(fixture.componentInstance.loadError()).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Could not load care documents.');
  });
});

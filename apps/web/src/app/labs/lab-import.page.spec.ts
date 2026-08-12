import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LabImportPage } from './lab-import.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute, Router } from '@angular/router';

const PARSED = {
  format: 'quest',
  labName: 'Quest Diagnostics',
  specimenId: 'AB123456C',
  collectedAt: '2026-07-20T09:10:00.000Z',
  reportedAt: '2026-07-21T18:35:00.000Z',
  orderingProvider: 'SMITH,ALEX',
  patientName: 'DOE,JANE',
  analytes: [
    {
      analyte: 'FERRITIN',
      valueText: '37',
      value: 37,
      unit: 'ng/mL',
      flag: 'L',
      refLow: 38,
      refHigh: 380,
      refText: null,
      panel: 'FERRITIN',
    },
    {
      analyte: 'ALBUMIN',
      valueText: '4.6',
      value: 4.6,
      unit: 'g/dL',
      flag: null,
      refLow: 3.6,
      refHigh: 5.1,
      refText: null,
      panel: 'CHEMISTRY',
    },
  ],
  warnings: ['See Note 1'],
};

// Index-aligned with PARSED.analytes: ferritin is already in the catalog and disagrees with the
// report; albumin has never been seen.
const RESOLUTIONS = [
  {
    analyte: 'FERRITIN',
    analyteId: 'a-ferritin',
    displayName: 'Ferritin',
    status: 'conflict',
    catalogRange: { id: 'r1', refLow: 30, refHigh: 400, refText: null, effectiveFrom: 1700000000 },
    goal: { goalLow: 120, goalHigh: null, note: 'athletic target' },
  },
  {
    analyte: 'ALBUMIN',
    analyteId: null,
    displayName: 'Albumin',
    status: 'new',
    catalogRange: null,
    goal: null,
  },
];

describe('LabImportPage', () => {
  let apiMock: any;
  let routerMock: any;

  function selectPdf(fixture: any) {
    const file = new File(['%PDF'], 'Quest_Labs.pdf', { type: 'application/pdf' });
    const input = { files: [file], value: '' } as any;
    fixture.componentInstance.onFileSelected({ target: input } as any);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    apiMock = { get: jest.fn(), post: jest.fn() };
    routerMock = { navigate: jest.fn() };
    apiMock.get.mockReturnValue(of({ id: 'p1', fullName: 'Ben Penkacik' }));

    await TestBed.configureTestingModule({
      imports: [LabImportPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'p1']]) } } },
      ],
    }).compileComponents();
  });

  it('uploads the PDF, parses it, and shows the preview with the patient-name cross-check', () => {
    apiMock.post
      .mockReturnValueOnce(of({ fileId: 'f1', url: '/api/files/f1' }))
      .mockReturnValueOnce(of({ fileId: 'f1', parsed: PARSED, resolutions: RESOLUTIONS }));
    const fixture = TestBed.createComponent(LabImportPage);
    fixture.detectChanges();

    selectPdf(fixture);

    expect(apiMock.post).toHaveBeenNthCalledWith(2, '/patients/p1/lab-imports', { fileId: 'f1' });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ferritin'); // the catalog's display name once resolved
    expect(text).toContain('DOE,JANE');
    expect(text).toContain('Ben Penkacik');
    expect(text).toContain('See Note 1');
    // A never-seen analyte is badged; a disagreeing range asks, unchecked.
    expect(text).toContain('new');
    expect(text).toContain('Update the catalog');
    expect(fixture.componentInstance.rows()[0].updateCatalog).toBe(false);
    // The patient's goal rides along for display.
    expect(text).toContain('at or above 120');
    // All rows selected by default, label prefilled from the file name.
    expect(fixture.componentInstance.selectedCount()).toBe(2);
    expect(fixture.componentInstance.documentLabel).toBe('Quest_Labs.pdf');
  });

  it('confirms in three steps: resolve names, write accepted ranges, then create the observation', () => {
    apiMock.post
      .mockReturnValueOnce(of({ fileId: 'f1', url: '/api/files/f1' }))
      .mockReturnValueOnce(of({ fileId: 'f1', parsed: PARSED, resolutions: RESOLUTIONS }))
      .mockReturnValueOnce(
        of([
          { name: 'FERRITIN', analyteId: 'a-ferritin', displayName: 'Ferritin', created: false },
          { name: 'ALBUMIN', analyteId: 'a-albumin', displayName: 'Albumin', created: true },
        ]),
      )
      .mockReturnValueOnce(of({ id: 'range-new' })) // albumin's first range (status 'new')
      .mockReturnValueOnce(of({ id: 'obs1' }));
    const fixture = TestBed.createComponent(LabImportPage);
    fixture.detectChanges();
    selectPdf(fixture);
    fixture.componentInstance.confirm();

    // 1. Every selected printed name becomes an id, carrying the context the report printed so a
    //    newly created catalog entry isn't a bare name with nothing to place it.
    expect(apiMock.post.mock.calls[2]).toEqual([
      '/analytes/resolve',
      {
        analytes: [
          { name: 'FERRITIN', unit: 'ng/mL', panel: 'FERRITIN' },
          { name: 'ALBUMIN', unit: 'g/dL', panel: 'CHEMISTRY' },
        ],
      },
    ]);

    // 2. Only the new analyte's range is written — the ferritin conflict was left unchecked, so
    //    the catalog keeps what it had.
    const rangeCalls = apiMock.post.mock.calls.filter((c: any[]) => String(c[0]).includes('reference-ranges'));
    expect(rangeCalls).toHaveLength(1);
    expect(rangeCalls[0][0]).toBe('/analytes/a-albumin/reference-ranges');
    expect(rangeCalls[0][1]).toMatchObject({ refLow: 3.6, refHigh: 5.1, source: 'Quest Diagnostics report AB123456C' });

    // 3. The observation carries analyteIds and no reference-range fields.
    const [path, body] = apiMock.post.mock.calls[4];
    expect(path).toBe('/patients/p1/observations');
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0]).toEqual({
      type: 'lab_result',
      metadata: {
        analyteId: 'a-ferritin',
        analyte: 'FERRITIN',
        valueText: '37',
        value: 37,
        unit: 'ng/mL',
        flag: 'L',
        panel: 'FERRITIN',
      },
    });
    expect(body.entries[2]).toEqual({ type: 'document', metadata: { fileId: 'f1', label: 'Quest_Labs.pdf' } });
    expect(body.text).toContain('Quest Diagnostics labs');
    expect(body.observedAt).toEqual(expect.any(String));
    expect(routerMock.navigate).toHaveBeenCalledWith(['/patients', 'p1', 'timeline']);
  });

  it('writes the report range for an accepted conflict, and only then', () => {
    apiMock.post
      .mockReturnValueOnce(of({ fileId: 'f1', url: '/api/files/f1' }))
      .mockReturnValueOnce(of({ fileId: 'f1', parsed: PARSED, resolutions: RESOLUTIONS }))
      .mockReturnValue(of([{ name: 'FERRITIN', analyteId: 'a-ferritin', displayName: 'Ferritin', created: false }]));
    const fixture = TestBed.createComponent(LabImportPage);
    fixture.detectChanges();
    selectPdf(fixture);

    // Keep only ferritin, and accept the catalog update this time.
    fixture.componentInstance.rows()[1].selected = false;
    fixture.componentInstance.rows()[0].updateCatalog = true;
    fixture.componentInstance.confirm();

    const rangeCalls = apiMock.post.mock.calls.filter((c: any[]) => String(c[0]).includes('reference-ranges'));
    expect(rangeCalls).toHaveLength(1);
    expect(rangeCalls[0][0]).toBe('/analytes/a-ferritin/reference-ranges');
    expect(rangeCalls[0][1]).toMatchObject({ refLow: 38, refHigh: 380 });
  });

  it('maps a parse failure to its sentence and stays on the upload step, keeping the file', () => {
    apiMock.post
      .mockReturnValueOnce(of({ fileId: 'f1', url: '/api/files/f1' }))
      .mockReturnValueOnce(throwError(() => ({ error: { message: 'LAB_FORMAT_UNSUPPORTED' } })));
    const fixture = TestBed.createComponent(LabImportPage);
    fixture.detectChanges();
    selectPdf(fixture);

    expect(fixture.componentInstance.phase()).toBe('upload');
    expect(fixture.componentInstance.error()).toContain("isn't supported yet");
    expect(fixture.componentInstance.uploadedFileId()).toBe('f1');
    expect(fixture.nativeElement.textContent).toContain('The PDF was saved');
  });

  it('flags printed out-of-range display only from refLow/refHigh', () => {
    const fixture = TestBed.createComponent(LabImportPage);
    expect(fixture.componentInstance.isOutOfRange(PARSED.analytes[0] as any)).toBe(true); // 37 < 38
    expect(fixture.componentInstance.isOutOfRange(PARSED.analytes[1] as any)).toBe(false);
    expect(fixture.componentInstance.isOutOfRange({ ...PARSED.analytes[0], value: null } as any)).toBe(false);
  });
});

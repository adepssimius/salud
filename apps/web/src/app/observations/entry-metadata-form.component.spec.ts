import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EntryDraft, EntryMetadataFormComponent, toCm, toKg } from './entry-metadata-form.component';
import { ApiClientService } from '../core/api-client.service';
import { AuthService } from '../core/auth.service';
import { TempUnit, LengthUnit, WeightUnit } from '@salud/shared/types';

describe('EntryMetadataFormComponent', () => {
  let apiMock: any;
  let authMock: any;

  function configure(prefs: { temp?: TempUnit; weight?: WeightUnit; length?: LengthUnit } = {}) {
    apiMock = { post: jest.fn() };
    authMock = {
      user: jest.fn().mockReturnValue({
        id: 'u1',
        email: 't@example.com',
        displayName: 'Tester',
        preferredTempUnit: prefs.temp ?? 'C',
        preferredWeightUnit: prefs.weight ?? 'kg',
        preferredLengthUnit: prefs.length ?? 'cm',
      }),
    };
    return TestBed.configureTestingModule({
      imports: [EntryMetadataFormComponent],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();
  }

  function create() {
    const fixture = TestBed.createComponent(EntryMetadataFormComponent);
    const emitted: EntryDraft[] = [];
    fixture.componentInstance.entryAdded.subscribe((d: EntryDraft) => emitted.push(d));
    fixture.detectChanges();
    return { fixture, comp: fixture.componentInstance, emitted };
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('unit conversion helpers', () => {
    it('converts weight to kg, rounded to 2dp', () => {
      expect(toKg(25, 'lb')).toBe(11.34);
      expect(toKg(2, 'st')).toBe(12.7);
      expect(toKg(11.5, 'kg')).toBe(11.5);
    });

    it('converts length to cm, rounded to 1dp', () => {
      expect(toCm(36, 'in')).toBe(91.4);
      expect(toCm(91.4, 'cm')).toBe(91.4);
    });
  });

  describe('number-driven types', () => {
    it('builds heart_rate metadata with an integer bpm', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'heart_rate';
      comp.numberValue = 120;
      comp.add();
      expect(emitted).toEqual([{ type: 'heart_rate', metadata: { bpm: 120, note: undefined } }]);
    });

    it('converts a weight entered in lb to canonical kg', async () => {
      await configure({ weight: 'lb' });
      const { comp, emitted } = create();
      comp.entryType = 'weight';
      comp.numberValue = 25;
      expect(comp.numberUnitLabel()).toBe('lb');
      expect(comp.numberConversionHint()).toBe('= 11.34 kg');
      comp.add();
      expect(emitted[0].metadata.kg).toBe(11.34);
    });

    it('converts a height entered in inches to canonical cm', async () => {
      await configure({ length: 'in' });
      const { comp, emitted } = create();
      comp.entryType = 'height';
      comp.numberValue = 36;
      expect(comp.numberConversionHint()).toBe('= 91.4 cm');
      comp.add();
      expect(emitted[0].metadata.cm).toBe(91.4);
    });

    it('shows no conversion hint when already in canonical units', async () => {
      await configure({ weight: 'kg' });
      const { comp } = create();
      comp.entryType = 'weight';
      comp.numberValue = 11.5;
      expect(comp.numberConversionHint()).toBeNull();
    });

    it('rejects an out-of-range oxygen saturation', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'oxygen_saturation';
      comp.numberValue = 120;
      comp.add();
      expect(comp.error()).toBe('Oxygen saturation must be at most 100.');
      expect(emitted.length).toBe(0);
    });

    it('rejects a missing value', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'heart_rate';
      comp.add();
      expect(comp.error()).toBe('Heart rate is required.');
      expect(emitted.length).toBe(0);
    });
  });

  describe('temperature', () => {
    it('defaults the unit toggle to the caregiver preference and stores the value as entered', async () => {
      await configure({ temp: 'F' });
      const { comp, emitted } = create();
      expect(comp.tempUnit).toBe('F');
      comp.entryType = 'temperature';
      comp.tempValue = 101.2;
      comp.tempMethod = 'oral';
      comp.add();
      expect(emitted[0]).toEqual({
        type: 'temperature',
        metadata: { value: 101.2, unit: 'F', method: 'oral', note: undefined },
      });
    });

    it('picks up the preference that arrives after construction (cold load)', async () => {
      // On a hard reload the component is built before auth.me() resolves, so the preference must
      // be resolved on read — a constructor snapshot would be stuck on the fallback forever.
      await configure({ temp: 'F' });
      authMock.user.mockReturnValue(null);
      const { comp } = create();
      expect(comp.tempUnit).toBe('C');

      authMock.user.mockReturnValue({ preferredTempUnit: 'F', preferredWeightUnit: 'kg', preferredLengthUnit: 'cm' });
      expect(comp.tempUnit).toBe('F');
    });

    it('allows overriding the unit away from the preference', async () => {
      await configure({ temp: 'F' });
      const { comp, emitted } = create();
      comp.entryType = 'temperature';
      comp.tempValue = 38.2;
      comp.tempUnit = 'C';
      comp.add();
      expect(emitted[0].metadata.unit).toBe('C');
    });

    it('seeds the method from initialTempMethod, and resets back to it rather than to unknown', async () => {
      await configure();
      const fixture = TestBed.createComponent(EntryMetadataFormComponent);
      const comp = fixture.componentInstance;
      comp.initialTempMethod = 'tympanic';
      const emitted: EntryDraft[] = [];
      comp.entryAdded.subscribe((d: EntryDraft) => emitted.push(d));
      fixture.detectChanges();

      // Seeded, not locked — the select stays editable on the form.
      expect(comp.tempMethod).toBe('tympanic');
      comp.entryType = 'temperature';
      comp.tempValue = 38.2;
      comp.add();
      expect(emitted[0].metadata.method).toBe('tympanic');
      // Same-session stickiness, matching the unit toggle: the next entry keeps the habit.
      expect(comp.tempMethod).toBe('tympanic');
    });
  });

  describe('other explicit types', () => {
    it('builds a pain score from the segmented buttons', async () => {
      await configure();
      const { fixture, comp, emitted } = create();
      comp.entryType = 'pain_score';
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.pain-scale button').length).toBe(11);
      comp.painScore = 7;
      comp.add();
      expect(emitted[0]).toEqual({ type: 'pain_score', metadata: { score: 7, note: undefined } });
    });

    it('rejects a pain entry with no score chosen', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'pain_score';
      comp.add();
      expect(comp.error()).toBe('Choose a pain score.');
      expect(emitted.length).toBe(0);
    });

    it('converts every lesion dimension to cm and requires a body location', async () => {
      await configure({ length: 'in' });
      const { comp, emitted } = create();
      comp.entryType = 'lesion_size';
      comp.lesionLength = 1;
      comp.lesionWidth = 2;

      comp.add();
      expect(comp.error()).toBe('Body location is required.');

      comp.bodyLocation = ' left forearm ';
      comp.side = 'left';
      comp.add();
      expect(emitted[0].metadata).toEqual({
        lengthCm: 2.5,
        widthCm: 5.1,
        depthCm: null,
        bodyLocation: 'left forearm',
        side: 'left',
        note: undefined,
      });
    });

    it('builds symptom metadata, omitting severity when unset', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'symptom';
      comp.symptomTag = 'cough';
      comp.add();
      expect(emitted[0].metadata).toEqual({ tag: 'cough', severity: undefined, note: undefined });
    });

    it('builds tag and note metadata and rejects blanks', async () => {
      await configure();
      const { comp, emitted } = create();

      comp.entryType = 'tag';
      comp.add();
      expect(comp.error()).toBe('Tag is required.');
      comp.tagValue = 'poor appetite';
      comp.add();
      expect(emitted[0].metadata).toEqual({ tag: 'poor appetite', note: undefined });

      comp.entryType = 'note';
      comp.add();
      expect(comp.error()).toBe('Note text is required.');
      comp.noteText = 'slept badly';
      comp.add();
      expect(emitted[1].metadata).toEqual({ text: 'slept badly', symptom: undefined });
    });

    it('carries the optional note onto the metadata', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'heart_rate';
      comp.numberValue = 90;
      comp.entryNote = 'after a nap';
      comp.add();
      expect(emitted[0].metadata.note).toBe('after a nap');
    });
  });

  describe('photo', () => {
    it('uploads the file immediately and adds the entry once fields are filled', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.patientId = 'p1';
      comp.entryType = 'photo';
      apiMock.post.mockReturnValue(of({ fileId: 'file-1', url: '/api/files/file-1' }));

      const file = new File(['x'], 'rash.png', { type: 'image/png' });
      comp.onPhotoFileSelected({ target: { files: [file] } as unknown as HTMLInputElement } as unknown as Event);

      expect(apiMock.post).toHaveBeenCalledWith('/files', expect.any(FormData));
      expect(comp.photoUploadedFileId()).toBe('file-1');

      comp.bodyLocation = 'left forearm';
      comp.add();
      expect(emitted[0].metadata).toEqual({
        fileId: 'file-1',
        bodyLocation: 'left forearm',
        side: 'n/a',
        sizeCm: null,
        note: undefined,
      });
      expect(comp.photoUploadedFileId()).toBeNull();
    });

    it('converts photo size from the preferred length unit', async () => {
      await configure({ length: 'in' });
      const { comp, emitted } = create();
      comp.entryType = 'photo';
      comp.photoUploadedFileId.set('file-1');
      comp.bodyLocation = 'back';
      comp.photoSize = 2;
      comp.add();
      expect(emitted[0].metadata.sizeCm).toBe(5.1);
    });

    it('refuses to add without an uploaded file', async () => {
      await configure();
      const { comp, emitted } = create();
      comp.entryType = 'photo';
      comp.add();
      expect(comp.error()).toBe('Upload a photo before adding the entry.');
      expect(emitted.length).toBe(0);
    });

    it('surfaces an upload failure', async () => {
      await configure();
      const { comp } = create();
      comp.patientId = 'p1';
      apiMock.post.mockReturnValue(throwError(() => new Error('fail')));
      const file = new File(['x'], 'rash.png', { type: 'image/png' });
      comp.onPhotoFileSelected({ target: { files: [file] } as unknown as HTMLInputElement } as unknown as Event);
      expect(comp.photoUploadError()).toBe('Could not upload photo.');
      expect(comp.photoUploading()).toBe(false);
    });

    it('refuses to upload before a patient is chosen', async () => {
      await configure();
      const { comp } = create();
      comp.entryType = 'photo';
      const input = { files: [new File(['x'], 'a.png')], value: 'a.png' } as unknown as HTMLInputElement;
      comp.onPhotoFileSelected({ target: input } as unknown as Event);
      expect(apiMock.post).not.toHaveBeenCalled();
      expect(comp.error()).toBe('Select a patient before adding a photo.');
    });
  });

  it('emits typeChange and clears the error when the type changes', async () => {
    await configure();
    const { comp } = create();
    const seen: string[] = [];
    comp.typeChange.subscribe((t) => seen.push(t));
    comp.error.set('stale');
    comp.onTypeChange('photo');
    expect(seen).toEqual(['photo']);
    expect(comp.error()).toBeNull();
  });

  it('resets fields after a successful add', async () => {
    await configure();
    const { comp } = create();
    comp.entryType = 'symptom';
    comp.symptomTag = 'cough';
    comp.entryNote = 'dry';
    comp.add();
    expect(comp.symptomTag).toBe('');
    expect(comp.entryNote).toBe('');
  });

  it('renders no JSON metadata textarea for any entry type', async () => {
    await configure();
    const { fixture, comp } = create();
    for (const type of comp.types) {
      comp.entryType = type;
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Metadata (JSON)');
    }
  });
});

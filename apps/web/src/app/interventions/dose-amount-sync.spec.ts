import { FormControl } from '@angular/forms';
import { AmountEmbodiment, DoseAmountSync, amountBoxesFor } from './dose-amount-sync';

describe('DoseAmountSync', () => {
  const embodiments: Record<string, AmountEmbodiment> = {
    infant: { concentrationMgPerMl: 32, strengthMgPerUnit: null, unitType: 'ml' }, // 160 mg / 5 mL
    childrens: { concentrationMgPerMl: 20, strengthMgPerUnit: null, unitType: 'ml' },
    tablet: { concentrationMgPerMl: null, strengthMgPerUnit: 500, unitType: 'tablet' },
    chewable: { concentrationMgPerMl: null, strengthMgPerUnit: 80, unitType: 'tablet' },
    cream: { concentrationMgPerMl: null, strengthMgPerUnit: null, unitType: 'other' },
    typedCream: { concentrationMgPerMl: null, strengthMgPerUnit: null, unitType: 'other', dosageForm: 'cream' },
    eyeDrops: { concentrationMgPerMl: null, strengthMgPerUnit: 0.5, unitType: 'drop' },
    // A liquid that also carries a per-unit strength: its kind still hides the count.
    oddLiquid: { concentrationMgPerMl: 32, strengthMgPerUnit: 160, unitType: 'ml' },
  };
  let loaded: Record<string, AmountEmbodiment>;
  let mg: FormControl<number | null>;
  let ml: FormControl<number | null>;
  let pills: FormControl<number | null>;
  let embodiment: FormControl<string>;
  let sync: DoseAmountSync;

  beforeEach(() => {
    loaded = { ...embodiments };
    mg = new FormControl<number | null>(null);
    ml = new FormControl<number | null>(null);
    pills = new FormControl<number | null>(null);
    embodiment = new FormControl('', { nonNullable: true });
    sync = new DoseAmountSync({ mg, ml, pills }, embodiment, (id) => loaded[id]);
  });

  it('typing mL fills mg — the reported 10 mL of infant suspension is 320 mg', () => {
    embodiment.setValue('infant');
    ml.setValue(10);
    expect(mg.value).toBe(320);
    expect(sync.mgDerived()).toBe(true);
  });

  it('typing mg fills mL, rounded to a drawable volume', () => {
    embodiment.setValue('infant');
    mg.setValue(174);
    expect(ml.value).toBe(5.4);
    expect(sync.mgDerived()).toBe(false);
  });

  it('pill count and mg fill each other, partial pills included', () => {
    embodiment.setValue('tablet');
    pills.setValue(1 / 2);
    expect(mg.value).toBe(250);
    mg.setValue(1000 / 3);
    expect(pills.value).toBeCloseTo(2 / 3, 10);
  });

  it('leaves the pill count empty rather than snapping mg to a count that misstates it', () => {
    embodiment.setValue('tablet');
    mg.setValue(320);
    expect(pills.value).toBeNull();
  });

  it('calculates nothing for an embodiment with neither figure', () => {
    embodiment.setValue('cream');
    ml.setValue(3);
    expect(mg.value).toBeNull();
    mg.setValue(50);
    expect(ml.value).toBe(3);
  });

  it('recalculates from the box typed last when the embodiment changes', () => {
    embodiment.setValue('infant');
    ml.setValue(10);
    expect(mg.value).toBe(320);
    embodiment.setValue('childrens');
    expect(mg.value).toBe(200);
    expect(ml.value).toBe(10);

    // mg typed last: mL follows instead.
    mg.setValue(100);
    embodiment.setValue('infant');
    expect(mg.value).toBe(100);
    expect(ml.value).toBe(3.1); // 3.125 → nearest 0.1
  });

  it('clears a filled box the new embodiment cannot fill, but never a typed one', () => {
    embodiment.setValue('chewable');
    mg.setValue(200);
    expect(pills.value).toBe(2.5);
    embodiment.setValue('tablet'); // 200 / 500 = 0.4 is no offered fraction
    expect(pills.value).toBeNull();
    expect(mg.value).toBe(200);
  });

  describe('which boxes the embodiment shows (frontend.md → "The embodiment decides which amount boxes show")', () => {
    it('maps each dosage form to its boxes: mg on all but the topical forms', () => {
      const boxes = (dosageForm: any) => amountBoxesFor({ dosageForm });
      expect(boxes('liquid')).toEqual({ mg: true, ml: true, count: null, fractions: false });
      expect(boxes('tablet')).toEqual({ mg: true, ml: false, count: 'Tablets', fractions: true });
      expect(boxes('chewable')).toEqual({ mg: true, ml: false, count: 'Chewables', fractions: true });
      expect(boxes('capsule')).toEqual({ mg: true, ml: false, count: 'Capsules', fractions: true });
      expect(boxes('drops')).toEqual({ mg: true, ml: false, count: 'Drops', fractions: false });
      for (const topical of ['cream', 'ointment', 'gel']) {
        expect(boxes(topical)).toEqual({ mg: false, ml: false, count: null, fractions: false });
      }
      expect(boxes('other')).toEqual({ mg: true, ml: false, count: null, fractions: false });
      expect(amountBoxesFor(null)).toEqual({ mg: true, ml: false, count: null, fractions: false });
    });

    it('falls back to the unit type for a row with no form recorded', () => {
      expect(amountBoxesFor({ unitType: 'ml', dosageForm: null })).toMatchObject({ mg: true, ml: true, count: null });
      expect(amountBoxesFor({ unitType: 'tablet' })).toMatchObject({ count: 'Tablets' });
      expect(amountBoxesFor({ unitType: 'drop' })).toMatchObject({ count: 'Drops', fractions: false });
      // An untyped `other` is not assumed to be a cream: mg stays.
      expect(amountBoxesFor({ unitType: 'other' })).toMatchObject({ mg: true, ml: false, count: null });
    });

    it('switching to a cream empties every box, mg included', () => {
      embodiment.setValue('chewable');
      mg.setValue(160);
      expect(pills.value).toBe(2);
      embodiment.setValue('typedCream');
      expect(mg.value).toBeNull();
      expect(pills.value).toBeNull();
      // Nothing left to follow: typing nothing fills nothing.
      embodiment.setValue('chewable');
      expect(pills.value).toBeNull();
    });

    it('liquid → tablet empties the mL, keeps its mg as typed and fills the tablets from it', () => {
      embodiment.setValue('infant');
      ml.setValue(5);
      expect(mg.value).toBe(160);
      embodiment.setValue('chewable');
      expect(ml.value).toBeNull();
      expect(mg.value).toBe(160);
      expect(pills.value).toBe(2);
      // The volume it came from is gone, so the mg is the caregiver's figure now.
      expect(sync.mgDerived()).toBe(false);
      // …and mg is what later changes follow.
      mg.setValue(240);
      expect(pills.value).toBe(3);
    });

    it('tablet → liquid empties the count and fills the mL from the mg', () => {
      embodiment.setValue('chewable');
      pills.setValue(2);
      embodiment.setValue('infant');
      expect(pills.value).toBeNull();
      expect(mg.value).toBe(160);
      expect(ml.value).toBe(5);
    });

    it('switching to a cream empties both mL and count and leaves mg alone', () => {
      embodiment.setValue('infant');
      ml.setValue(5);
      embodiment.setValue('cream');
      expect(ml.value).toBeNull();
      expect(mg.value).toBe(160);
    });

    it('a hidden box with no mg to fall back on is emptied, and nothing is left to follow', () => {
      embodiment.setValue('cream');
      ml.setValue(3);
      embodiment.setValue('tablet');
      expect(ml.value).toBeNull();
      expect(mg.value).toBeNull();
      expect(pills.value).toBeNull();
    });

    it('the first embodiment arriving clears nothing, loaded late or not — a corrected dose keeps every stored amount', () => {
      delete loaded['tablet'];
      sync.set({ mg: 1000, ml: 5, pills: 2 }, 'mg');
      embodiment.setValue('tablet');
      loaded['tablet'] = embodiments['tablet'];
      sync.refresh();
      expect(ml.value).toBe(5);
      expect(pills.value).toBe(2);
    });

    it('picking the first embodiment from none keeps a prefilled box it would hide', () => {
      sync.set({ mg: null, ml: 5 }, 'ml');
      embodiment.setValue('tablet');
      expect(ml.value).toBe(5);
    });

    it('never fills a box the kind hides, even when the embodiment has the figure', () => {
      embodiment.setValue('oddLiquid');
      mg.setValue(160);
      expect(ml.value).toBe(5);
      expect(pills.value).toBeNull();
    });

    it('a switch through no embodiment (another medication picked) still clears what the new one hides', () => {
      embodiment.setValue('chewable');
      pills.setValue(2);
      embodiment.setValue('');
      embodiment.setValue('cream');
      expect(pills.value).toBeNull();
      // The mg came from the old tablets, so it went with their embodiment.
      expect(mg.value).toBeNull();
    });

    it('a drop count fills mg through mg per drop', () => {
      embodiment.setValue('eyeDrops');
      pills.setValue(2);
      expect(mg.value).toBe(1);
    });
  });

  it('waits for an embodiment that has not loaded yet instead of clearing, then refresh() fills mg', () => {
    delete loaded['infant'];
    sync.set({ mg: null, ml: 10 }, 'ml');
    embodiment.setValue('infant');
    expect(mg.value).toBeNull();
    loaded['infant'] = embodiments['infant'];
    sync.refresh();
    expect(mg.value).toBe(320);
    expect(sync.mgDerived()).toBe(true);
  });

  it('set() is not typing: it fills nothing and follows the source it was given', () => {
    embodiment.setValue('infant');
    sync.set({ mg: 180, ml: 5.6 }, 'mg');
    expect(mg.value).toBe(180);
    expect(ml.value).toBe(5.6); // an engine-rounded volume is kept, not re-derived
    expect(sync.mgDerived()).toBe(false);
  });

  it('refresh() only fills an empty mg, never an mL the dose was not given', () => {
    embodiment.setValue('infant');
    sync.set({ mg: 320 }, 'mg');
    sync.refresh();
    expect(ml.value).toBeNull();
  });
});

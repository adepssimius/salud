import { FormControl } from '@angular/forms';
import { DoseAmountEmbodiment } from '@salud/shared/types';
import { DoseAmountSync } from './dose-amount-sync';

describe('DoseAmountSync', () => {
  const embodiments: Record<string, DoseAmountEmbodiment> = {
    infant: { concentrationMgPerMl: 32, strengthMgPerUnit: null }, // 160 mg / 5 mL
    childrens: { concentrationMgPerMl: 20, strengthMgPerUnit: null },
    tablet: { concentrationMgPerMl: null, strengthMgPerUnit: 500 },
    cream: { concentrationMgPerMl: null, strengthMgPerUnit: null },
  };
  let loaded: Record<string, DoseAmountEmbodiment>;
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
    embodiment.setValue('infant');
    ml.setValue(10);
    embodiment.setValue('cream');
    expect(mg.value).toBeNull();
    expect(ml.value).toBe(10);
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

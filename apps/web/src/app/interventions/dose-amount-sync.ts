import { AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  DoseAmountEmbodiment,
  DosageForm,
  MedicationUnitType,
  TOPICAL_DOSAGE_FORMS,
  mgFromMl,
  mgFromPills,
  mlFromMg,
  pillsFromMg,
} from '@salud/shared/types';

export type AmountBox = 'mg' | 'ml' | 'pills';

/** An embodiment as the amount boxes see it: its figures, and the kind that picks the boxes. */
export type AmountEmbodiment = DoseAmountEmbodiment & {
  unitType?: MedicationUnitType | null;
  dosageForm?: DosageForm | null;
};

/** Which boxes an embodiment shows, and what the count is called. */
export interface AmountBoxes {
  mg: boolean;
  ml: boolean;
  /** The count box's label; null when the kind has no count. */
  count: 'Tablets' | 'Chewables' | 'Capsules' | 'Drops' | null;
  /** Whether the count takes a fraction (pills split; drops don't). */
  fractions: boolean;
}

const MG_ALONE: AmountBoxes = { mg: true, ml: false, count: null, fractions: false };

/**
 * frontend.md → "Dose entry" → "The embodiment decides which amount boxes show". Keyed on the
 * dosage form; a row with no form recorded falls back to its unit type. No embodiment: mg alone.
 */
export function amountBoxesFor(embodiment: Pick<AmountEmbodiment, 'unitType' | 'dosageForm'> | null | undefined): AmountBoxes {
  const form = embodiment?.dosageForm;
  if (form) {
    if (TOPICAL_DOSAGE_FORMS.includes(form)) return { mg: false, ml: false, count: null, fractions: false };
    switch (form) {
      case 'liquid':
        return { mg: true, ml: true, count: null, fractions: false };
      case 'tablet':
        return { mg: true, ml: false, count: 'Tablets', fractions: true };
      case 'chewable':
        return { mg: true, ml: false, count: 'Chewables', fractions: true };
      case 'capsule':
        return { mg: true, ml: false, count: 'Capsules', fractions: true };
      case 'drops':
        return { mg: true, ml: false, count: 'Drops', fractions: false };
      default:
        return MG_ALONE;
    }
  }
  switch (embodiment?.unitType) {
    case 'ml':
      return { mg: true, ml: true, count: null, fractions: false };
    case 'tablet':
      return { mg: true, ml: false, count: 'Tablets', fractions: true };
    case 'capsule':
      return { mg: true, ml: false, count: 'Capsules', fractions: true };
    case 'drop':
      return { mg: true, ml: false, count: 'Drops', fractions: false };
    default:
      return MG_ALONE;
  }
}

/** Whether `box` shows for these boxes. */
export function boxShown(boxes: AmountBoxes, box: AmountBox): boolean {
  return box === 'mg' ? boxes.mg : box === 'ml' ? boxes.ml : !!boxes.count;
}

/** An embodiment that says what kind it is — one without either field is left unrestricted. */
function hasKind(e: AmountEmbodiment | null | undefined): e is AmountEmbodiment {
  return !!(e?.dosageForm || e?.unitType);
}

/**
 * Keeps the dose form's mg, mL and pill-count boxes in step (frontend.md → "Dose entry" → "The
 * amount boxes fill each other").
 *
 * The box the caregiver typed in last is the source; the others are filled from it through mg,
 * using the selected embodiment's concentration or per-pill strength and the shared
 * `dose-amounts` helpers the API derives `amountMg` with. A box this class filled is "derived":
 * it is overwritten when the source changes and cleared when the embodiment can no longer fill
 * it. A box the caregiver typed in is never touched by anything but the caregiver.
 *
 * Programmatic fills (prefill, "Use this", a correction's stored values) go through `set()`, which
 * patches without being read as typing.
 */
export class DoseAmountSync {
  private source: AmountBox | null = null;
  private readonly derived = new Set<AmountBox>();
  private suppress = false;
  private embodimentId: string | null = null;
  /**
   * The last embodiment the boxes were set for. Kept through an empty pick, so going tablet →
   * (another medication, "Select…") → cream still counts as a switch and clears the count.
   */
  private lastEmbodiment: AmountEmbodiment | null = null;
  private readonly subs = new Subscription();

  constructor(
    private readonly controls: Record<AmountBox, AbstractControl<number | null>>,
    private readonly embodimentControl: AbstractControl<string>,
    /** The embodiment with this id; undefined while the list is not loaded yet. */
    private readonly lookup: (id: string) => AmountEmbodiment | undefined,
  ) {
    for (const box of ['mg', 'ml', 'pills'] as const) {
      this.subs.add(controls[box].valueChanges.subscribe(() => this.onTyped(box)));
    }
    this.embodimentId = embodimentControl.value || null;
    this.subs.add(embodimentControl.valueChanges.subscribe((id) => this.onEmbodiment(id || null)));
  }

  destroy(): void {
    this.subs.unsubscribe();
  }

  /** True when the mg box holds a figure this class worked out — the server derives it too. */
  mgDerived(): boolean {
    return this.derived.has('mg') && this.controls.mg.value != null;
  }

  /**
   * Patch amounts without reading it as typing. `source` is the box later changes follow;
   * `derived` lists the boxes in `values` that were themselves worked out rather than given.
   */
  set(values: Partial<Record<AmountBox, number | null>>, source: AmountBox | null, derived: AmountBox[] = []): void {
    this.suppress = true;
    try {
      for (const box of Object.keys(values) as AmountBox[]) {
        this.controls[box].setValue(values[box] ?? null);
      }
    } finally {
      this.suppress = false;
    }
    this.source = source;
    this.derived.clear();
    for (const box of derived) this.derived.add(box);
  }

  /**
   * The embodiment list arrived (or was replaced). Fills an empty mg box from the source — how a
   * dose stored with only mL gets its mg on a correction, so Save repairs it — and touches
   * nothing else: an mg-only dose being corrected does not grow an mL it was never given.
   */
  refresh(): void {
    this.lastEmbodiment = this.embodiment() ?? this.lastEmbodiment;
    if (!this.source || this.source === 'mg' || !this.embodiment()) return;
    if (this.controls.mg.value != null) return;
    const value = this.compute(this.source, 'mg');
    if (value == null) return;
    this.write('mg', value);
    this.derived.add('mg');
  }

  private onTyped(box: AmountBox): void {
    if (this.suppress) return;
    this.source = box;
    this.derived.delete(box);
    this.recompute();
  }

  private onEmbodiment(id: string | null): void {
    if (this.suppress || id === this.embodimentId) return;
    this.embodimentId = id;
    // An id whose embodiment is not loaded yet is not "an embodiment without figures": wait for
    // refresh() rather than clearing what it might fill.
    const next = id ? this.lookup(id) : undefined;
    if (id && !next) return;
    // Only a switch from one embodiment to another clears: the first one arriving (a prefill or a
    // correction loading its bottle) must not empty a stored amount the caregiver hasn't seen yet.
    if (this.lastEmbodiment && hasKind(next)) this.clearHidden(next);
    if (next) this.lastEmbodiment = next;
    this.recompute();
  }

  /**
   * Empty the boxes `embodiment` hides (frontend.md → "Switching embodiment clears what the new one
   * hides"). When the emptied box was the source, mg takes over if it is still shown — it stands as
   * typed, since the volume or count it came from is gone — and the newly shown box fills from it.
   */
  private clearHidden(embodiment: AmountEmbodiment): void {
    const shown = amountBoxesFor(embodiment);
    const hidden = (['mg', 'ml', 'pills'] as const).filter((b) => !boxShown(shown, b));
    for (const box of hidden) {
      if (this.controls[box].value == null) continue;
      if (this.source === box) {
        this.source = shown.mg && this.controls.mg.value != null ? 'mg' : null;
        this.derived.delete('mg');
      }
      this.write(box, null);
      this.derived.delete(box);
    }
    if (this.source && hidden.includes(this.source)) this.source = null;
  }


  private recompute(): void {
    if (!this.source) return;
    for (const target of this.targets(this.source)) {
      const value = this.compute(this.source, target);
      if (value != null) {
        this.write(target, value);
        this.derived.add(target);
      } else if (this.derived.has(target)) {
        this.write(target, null);
        this.derived.delete(target);
      }
    }
  }

  /** The boxes a change in `source` fills: never one the selected embodiment's kind hides. */
  private targets(source: AmountBox): AmountBox[] {
    const e = this.embodiment();
    const shown = hasKind(e) ? amountBoxesFor(e) : null;
    return (['mg', 'ml', 'pills'] as const).filter((b) => b !== source && (!shown || boxShown(shown, b)));
  }

  private embodiment(): AmountEmbodiment | null {
    const id = this.embodimentControl.value;
    return id ? (this.lookup(id) ?? null) : null;
  }

  /** `target` worked out from the source box, through mg; null when the embodiment can't say. */
  private compute(source: AmountBox, target: AmountBox): number | null {
    const e = this.embodiment();
    if (!e) return null;
    const raw = this.controls[source].value;
    if (raw == null) return null;
    const mg =
      source === 'mg'
        ? raw
        : source === 'ml'
          ? mgFromMl(raw, e.concentrationMgPerMl)
          : mgFromPills(raw, e.strengthMgPerUnit);
    if (mg == null) return null;
    if (target === 'mg') return mg;
    if (target === 'ml') return mlFromMg(mg, e.concentrationMgPerMl);
    return pillsFromMg(mg, e.strengthMgPerUnit);
  }

  private write(box: AmountBox, value: number | null): void {
    this.suppress = true;
    try {
      // emitEvent stays on so the page's debounced dose check sees the filled value.
      this.controls[box].setValue(value);
    } finally {
      this.suppress = false;
    }
  }
}

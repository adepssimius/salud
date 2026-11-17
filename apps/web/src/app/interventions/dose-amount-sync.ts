import { AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DoseAmountEmbodiment, mgFromMl, mgFromPills, mlFromMg, pillsFromMg } from '@salud/shared/types';

export type AmountBox = 'mg' | 'ml' | 'pills';

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
  private readonly subs = new Subscription();

  constructor(
    private readonly controls: Record<AmountBox, AbstractControl<number | null>>,
    private readonly embodimentControl: AbstractControl<string>,
    /** The embodiment with this id; undefined while the list is not loaded yet. */
    private readonly lookup: (id: string) => DoseAmountEmbodiment | undefined,
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
    if (id && !this.lookup(id)) return;
    this.recompute();
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

  private targets(source: AmountBox): AmountBox[] {
    return (['mg', 'ml', 'pills'] as const).filter((b) => b !== source);
  }

  private embodiment(): DoseAmountEmbodiment | null {
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

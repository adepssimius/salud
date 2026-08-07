import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { Condition, ConditionContact, ConditionStatus, CreateConditionDto } from '@salud/shared/types';

@Component({
  selector: 'app-new-condition-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="card">
      <h1>New Condition</h1>
      <p class="muted">A standing frame for chronic illness — open-ended, carries baselines, devices, and care-team contacts.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="grid">
          <label class="field">
            <span>Name</span>
            <input type="text" formControlName="name" placeholder="e.g. ALL treatment" />
          </label>
          <label class="field">
            <span>Status</span>
            <select formControlName="status">
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Diagnosis (as stated by the care team)</span>
          <textarea rows="2" formControlName="diagnosisText"></textarea>
        </label>

        <div class="list-field">
          <span>Baselines — what "normal" looks like for this patient</span>
          <ul class="chip-list">
            <li *ngFor="let b of baselines(); let i = index">
              <span>{{ b }}</span>
              <button type="button" class="icon-button" (click)="removeBaseline(i)">✕</button>
            </li>
          </ul>
          <div class="inline">
            <input type="text" [(ngModel)]="baselineDraft" [ngModelOptions]="{ standalone: true }" placeholder="e.g. resting HR runs 110" />
            <button type="button" class="secondary" (click)="addBaseline()">Add</button>
          </div>
        </div>

        <div class="list-field">
          <span>Devices</span>
          <ul class="chip-list">
            <li *ngFor="let d of devices(); let i = index">
              <span>{{ d }}</span>
              <button type="button" class="icon-button" (click)="removeDevice(i)">✕</button>
            </li>
          </ul>
          <div class="inline">
            <input type="text" [(ngModel)]="deviceDraft" [ngModelOptions]="{ standalone: true }" placeholder="e.g. port" />
            <button type="button" class="secondary" (click)="addDevice()">Add</button>
          </div>
        </div>

        <div class="list-field">
          <span>Care team contacts</span>
          <ul class="contact-list">
            <li *ngFor="let c of contacts(); let i = index">
              <span>{{ c.name }} — {{ c.role }} — {{ c.phone }}</span>
              <button type="button" class="icon-button" (click)="removeContact(i)">✕</button>
            </li>
          </ul>
          <div class="inline">
            <input type="text" [(ngModel)]="contactDraft.name" [ngModelOptions]="{ standalone: true }" placeholder="Name" />
            <input type="text" [(ngModel)]="contactDraft.role" [ngModelOptions]="{ standalone: true }" placeholder="Role" />
            <input type="text" [(ngModel)]="contactDraft.phone" [ngModelOptions]="{ standalone: true }" placeholder="Phone" />
            <button type="button" class="secondary" (click)="addContact()">Add</button>
          </div>
        </div>

        <div class="actions">
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Create condition' }}
          </button>
        </div>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
  styles: [
    `
      .card {
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .muted {
        color: #cbd5e1;
        margin: 0;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
      }
      input,
      select,
      textarea {
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      textarea {
        resize: vertical;
      }
      .list-field {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .list-field > span {
        color: #cbd5e1;
        font-size: 0.9rem;
      }
      .chip-list,
      .contact-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .contact-list {
        flex-direction: column;
      }
      .chip-list li,
      .contact-list li {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
      }
      .contact-list li {
        border-radius: 8px;
        justify-content: space-between;
      }
      .icon-button {
        border: none;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        padding: 0;
      }
      .inline {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .inline input {
        flex: 1;
        min-width: 120px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-top: 0.5rem;
      }
      .primary,
      .secondary {
        padding: 0.65rem 1rem;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
        border: none;
      }
      .primary {
        background: linear-gradient(135deg, #0ea5e9, #22d3ee);
        color: #0b1224;
      }
      .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #e2e8f0;
      }
      .error {
        color: #fca5a5;
      }
    `,
  ],
})
export class NewConditionPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  patientId = '';
  saving = signal(false);
  error = signal<string | null>(null);

  baselines = signal<string[]>([]);
  baselineDraft = '';
  devices = signal<string[]>([]);
  deviceDraft = '';
  contacts = signal<ConditionContact[]>([]);
  contactDraft: ConditionContact = { name: '', role: '', phone: '' };

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    status: this.fb.control<ConditionStatus>('active', { nonNullable: true }),
    diagnosisText: [''],
  });

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id') ?? '';
  }

  addBaseline() {
    const v = this.baselineDraft.trim();
    if (!v) return;
    this.baselines.set([...this.baselines(), v]);
    this.baselineDraft = '';
  }

  removeBaseline(i: number) {
    this.baselines.set(this.baselines().filter((_, idx) => idx !== i));
  }

  addDevice() {
    const v = this.deviceDraft.trim();
    if (!v) return;
    this.devices.set([...this.devices(), v]);
    this.deviceDraft = '';
  }

  removeDevice(i: number) {
    this.devices.set(this.devices().filter((_, idx) => idx !== i));
  }

  addContact() {
    const { name, role, phone } = this.contactDraft;
    if (!name.trim() || !role.trim() || !phone.trim()) return;
    this.contacts.set([...this.contacts(), { name: name.trim(), role: role.trim(), phone: phone.trim() }]);
    this.contactDraft = { name: '', role: '', phone: '' };
  }

  removeContact(i: number) {
    this.contacts.set(this.contacts().filter((_, idx) => idx !== i));
  }

  submit() {
    if (this.form.invalid || this.saving() || !this.patientId) return;
    this.saving.set(true);
    this.error.set(null);
    const val = this.form.getRawValue();
    const body: CreateConditionDto = {
      name: val.name,
      status: val.status,
      diagnosisText: val.diagnosisText || undefined,
      baselines: this.baselines().length ? this.baselines() : undefined,
      devices: this.devices().length ? this.devices() : undefined,
      contacts: this.contacts().length ? this.contacts() : undefined,
    };
    this.api.post<Condition, CreateConditionDto>(`/patients/${this.patientId}/conditions`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/patients', this.patientId]);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Could not create condition.'));
      },
    });
  }

  cancel() {
    this.router.navigate(['/patients', this.patientId]);
  }
}

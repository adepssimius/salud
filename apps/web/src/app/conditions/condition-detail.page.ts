import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClientService } from '../core/api-client.service';
import { errorText } from '../core/error-display';
import { RevisionHistoryComponent } from '../core/revision-history.component';
import {
  Condition,
  ConditionContact,
  ConditionStatus,
  CreateProtocolDto,
  Episode,
  InterventionSchedule,
  Protocol,
  ProtocolTriggerMetric,
  ProtocolTriggerOperator,
  UpdateConditionDto,
  UpdateProtocolDto,
} from '@salud/shared/types';

const TRIGGER_METRICS: ProtocolTriggerMetric[] = [
  'temperature',
  'heart_rate',
  'respiratory_rate',
  'oxygen_saturation',
  'pain_score',
];

@Component({
  selector: 'app-condition-detail-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RevisionHistoryComponent],
  template: `
    <div class="layout" *ngIf="condition() as c">
      <div class="card">
        <div class="card-header">
          <div>
            <h1>{{ c.name }}</h1>
            <p class="muted">Standing frame for chronic illness.</p>
          </div>
          <div class="header-actions">
            <button class="secondary" type="button" (click)="backToPatient()">Back</button>
            <button class="danger" type="button" (click)="deleteCondition()" [disabled]="deleting()">
              {{ deleting() ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>

        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="grid">
            <label class="field">
              <span>Name</span>
              <input type="text" formControlName="name" />
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
            <span>Diagnosis</span>
            <textarea rows="2" formControlName="diagnosisText"></textarea>
          </label>

          <div class="list-field">
            <span>Baselines</span>
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
              <li *ngFor="let ct of contacts(); let i = index">
                <span>{{ ct.name }} — {{ ct.role }} — {{ ct.phone }}</span>
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
            <button type="submit" class="primary" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Saving…' : 'Save changes' }}
            </button>
            <span class="muted" *ngIf="saveMessage()">{{ saveMessage() }}</span>
          </div>
        </form>
        <app-revision-history entityType="condition" [entityId]="conditionId"></app-revision-history>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Standing schedules</h2>
            <p class="muted">Regimens attached directly to this Condition.</p>
          </div>
          <button class="secondary" type="button" (click)="goToNewSchedule()">New schedule</button>
        </div>
        <ul class="row-list" *ngIf="schedules().length">
          <li *ngFor="let s of schedules()">
            <button type="button" class="row" (click)="goToSchedule(s.id)">
              <span class="name">{{ s.label }}</span>
              <span class="muted small">{{ s.status }} · {{ s.adherence.loggedCount }} logged, {{ s.adherence.missed }} missed</span>
            </button>
          </li>
        </ul>
        <p class="muted" *ngIf="!schedules().length">No standing schedules yet.</p>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Protocols</h2>
            <p class="muted">Standing clinician instructions — resurfaced automatically when an observation trips one.</p>
          </div>
        </div>
        <ul class="protocol-list" *ngIf="protocols().length">
          <li *ngFor="let p of protocols()" [class.inactive]="!p.active">
            <div class="protocol-header">
              <span class="name">{{ p.name }}</span>
              <button type="button" class="tiny" (click)="toggleProtocolActive(p)">{{ p.active ? 'Deactivate' : 'Activate' }}</button>
            </div>
            <p class="muted small">
              {{ p.triggerMetric }} {{ p.triggerOperator === 'gte' ? '≥' : '≤' }} {{ p.triggerValue }}
            </p>
            <p class="instruction">{{ p.instructionText }}</p>
            <p class="muted small">Source: {{ p.sourceText }}</p>
          </li>
        </ul>
        <p class="muted" *ngIf="!protocols().length">No protocols yet.</p>

        <form class="protocol-form" [formGroup]="protocolForm" (ngSubmit)="addProtocol()" novalidate>
          <div class="grid">
            <label class="field">
              <span>Name</span>
              <input type="text" formControlName="name" placeholder="e.g. Fever with port" />
            </label>
            <label class="field">
              <span>Metric</span>
              <select formControlName="triggerMetric">
                <option *ngFor="let m of triggerMetrics" [value]="m">{{ m }}</option>
              </select>
            </label>
            <label class="field">
              <span>Operator</span>
              <select formControlName="triggerOperator">
                <option value="gte">≥</option>
                <option value="lte">≤</option>
              </select>
            </label>
            <label class="field">
              <span>Value</span>
              <input type="number" step="0.1" formControlName="triggerValue" />
            </label>
          </div>
          <label class="field">
            <span>Instruction</span>
            <textarea rows="2" formControlName="instructionText" placeholder="ER immediately, do not give antipyretics first"></textarea>
          </label>
          <label class="field">
            <span>Source</span>
            <input type="text" formControlName="sourceText" placeholder="Dr. Okafor, 2026-03-01" />
          </label>
          <div class="actions">
            <button type="submit" class="secondary" [disabled]="protocolForm.invalid || savingProtocol()">
              {{ savingProtocol() ? 'Adding…' : 'Add protocol' }}
            </button>
          </div>
        </form>
      </div>

      <div class="card" *ngIf="episodes().length">
        <div class="card-header">
          <div>
            <h2>Nested episodes</h2>
            <p class="muted">Acute episodes logged under this Condition.</p>
          </div>
        </div>
        <ul class="row-list">
          <li *ngFor="let ep of episodes()">
            <button type="button" class="row" (click)="goToEpisode(ep.id)">
              <span class="name">{{ ep.name }}</span>
              <span class="muted small" *ngIf="ep.startedAt">started {{ ep.startedAt * 1000 | date: 'short' }}</span>
            </button>
          </li>
        </ul>
      </div>

      <p class="error" *ngIf="error()">{{ error() }}</p>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 900px;
      }
      .card-header {
        margin-bottom: 0.5rem;
      }
      h1,
      h2 {
        margin: 0;
      }
      .muted {
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.75rem;
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
        min-width: 100px;
      }
      .actions {
        align-items: center;
        margin-top: 0.25rem;
      }
      .danger,
      .tiny {
        padding: 0.65rem 1rem;
        border-radius: var(--radius-control);
        font-weight: 700;
        cursor: pointer;
        border: none;
      }
      .danger {
        background: rgba(248, 113, 113, 0.12);
        border: 1px solid rgba(248, 113, 113, 0.6);
        color: #fecdd3;
      }
      .tiny {
        padding: 0.3rem 0.6rem;
        font-size: 0.8rem;
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .row-list {
        gap: 0.5rem;
      }
      .row {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        align-items: flex-start;
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .name {
        font-weight: 700;
      }
      .protocol-list {
        list-style: none;
        padding: 0;
        margin: 0 0 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .protocol-list li {
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
      }
      .protocol-list li.inactive {
        opacity: 0.55;
      }
      .protocol-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .instruction {
        margin: 0.35rem 0;
        font-weight: 600;
      }
      .protocol-form {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.75rem;
      }
    `,
  ],
})
export class ConditionDetailPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  conditionId = '';
  condition = signal<Condition | null>(null);
  schedules = signal<InterventionSchedule[]>([]);
  protocols = signal<Protocol[]>([]);
  episodes = signal<Episode[]>([]);

  saving = signal(false);
  saveMessage = signal<string | null>(null);
  savingProtocol = signal(false);
  deleting = signal(false);
  error = signal<string | null>(null);

  baselines = signal<string[]>([]);
  baselineDraft = '';
  devices = signal<string[]>([]);
  deviceDraft = '';
  contacts = signal<ConditionContact[]>([]);
  contactDraft: ConditionContact = { name: '', role: '', phone: '' };

  triggerMetrics = TRIGGER_METRICS;

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    status: this.fb.control<ConditionStatus>('active', { nonNullable: true }),
    diagnosisText: [''],
  });

  protocolForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    triggerMetric: this.fb.control<ProtocolTriggerMetric>('temperature', { nonNullable: true }),
    triggerOperator: this.fb.control<ProtocolTriggerOperator>('gte', { nonNullable: true }),
    triggerValue: [38, Validators.required],
    instructionText: ['', Validators.required],
    sourceText: ['', Validators.required],
  });

  ngOnInit(): void {
    this.conditionId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.conditionId) return;
    this.load();
  }

  private load() {
    this.api.get<Condition>(`/conditions/${this.conditionId}`).subscribe({
      next: (c) => {
        this.condition.set(c);
        this.form.patchValue({
          name: c.name,
          status: c.status,
          diagnosisText: c.diagnosisText ?? '',
        });
        this.baselines.set(c.baselines ?? []);
        this.devices.set(c.devices ?? []);
        this.contacts.set(c.contacts ?? []);
        this.protocols.set(c.protocols ?? []);
        this.loadSchedules(c.scheduleIds ?? []);
        this.loadEpisodes(c.episodeIds ?? []);
      },
      error: (err) => this.error.set(errorText(err, 'Unable to load this condition.')),
    });
  }

  private loadSchedules(ids: string[]) {
    if (!ids.length) {
      this.schedules.set([]);
      return;
    }
    Promise.all(ids.map((id) => this.api.get<InterventionSchedule>(`/schedules/${id}`).toPromise())).then(
      (rows) => this.schedules.set(rows.filter((r): r is InterventionSchedule => !!r)),
      () => this.schedules.set([]),
    );
  }

  private loadEpisodes(ids: string[]) {
    if (!ids.length) {
      this.episodes.set([]);
      return;
    }
    Promise.all(ids.map((id) => this.api.get<Episode>(`/episodes/${id}`).toPromise())).then(
      (rows) => this.episodes.set(rows.filter((r): r is Episode => !!r)),
      () => this.episodes.set([]),
    );
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

  save() {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.saveMessage.set(null);
    const val = this.form.getRawValue();
    const body: UpdateConditionDto = {
      name: val.name,
      status: val.status,
      diagnosisText: val.diagnosisText || null,
      baselines: this.baselines(),
      devices: this.devices(),
      contacts: this.contacts(),
    };
    this.api.patch<Condition, UpdateConditionDto>(`/conditions/${this.conditionId}`, body).subscribe({
      next: (c) => {
        this.condition.set(c);
        this.saving.set(false);
        this.saveMessage.set('Saved');
      },
      error: (err) => {
        this.saving.set(false);
        this.saveMessage.set(errorText(err, 'Could not save.'));
      },
    });
  }

  addProtocol() {
    if (this.protocolForm.invalid || this.savingProtocol()) return;
    this.savingProtocol.set(true);
    const val = this.protocolForm.getRawValue();
    const body: CreateProtocolDto = { ...val };
    this.api.post<Protocol, CreateProtocolDto>(`/conditions/${this.conditionId}/protocols`, body).subscribe({
      next: (p) => {
        this.protocols.set([...this.protocols(), p]);
        this.savingProtocol.set(false);
        this.protocolForm.reset({
          name: '',
          triggerMetric: 'temperature',
          triggerOperator: 'gte',
          triggerValue: 38,
          instructionText: '',
          sourceText: '',
        });
      },
      error: () => this.savingProtocol.set(false),
    });
  }

  toggleProtocolActive(protocol: Protocol) {
    this.api
      .patch<Protocol, UpdateProtocolDto>(`/protocols/${protocol.id}`, { active: !protocol.active })
      .subscribe({
        next: (updated) => {
          this.protocols.set(this.protocols().map((p) => (p.id === updated.id ? updated : p)));
        },
      });
  }

  goToNewSchedule() {
    const patientId = this.condition()?.patientId;
    if (!patientId) return;
    this.router.navigate(['/schedules/new'], { queryParams: { conditionId: this.conditionId, patientId } });
  }

  goToSchedule(id: string) {
    this.router.navigate(['/schedules', id]);
  }

  goToEpisode(id: string) {
    this.router.navigate(['/episodes', id]);
  }

  backToPatient() {
    const patientId = this.condition()?.patientId;
    if (patientId) {
      this.router.navigate(['/patients', patientId]);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  deleteCondition() {
    if (this.deleting()) return;
    const confirmed = window.confirm('Delete this condition? This cannot be undone.');
    if (!confirmed) return;
    const patientId = this.condition()?.patientId;
    this.deleting.set(true);
    this.api.delete<{ deleted: boolean }>(`/conditions/${this.conditionId}`).subscribe({
      next: () => {
        this.deleting.set(false);
        this.router.navigate(patientId ? ['/patients', patientId] : ['/dashboard']);
      },
      error: (err) => {
        this.deleting.set(false);
        this.error.set(errorText(err, 'Could not delete condition.'));
      },
    });
  }
}

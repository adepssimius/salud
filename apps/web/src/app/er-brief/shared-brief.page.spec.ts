import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SharedBriefPage } from './shared-brief.page';
import { ApiClientService } from '../core/api-client.service';
import { ActivatedRoute } from '@angular/router';

const baseSnapshot = {
  payload: {
    header: {
      patient: { id: 'p1', fullName: 'Milo M5', dateOfBirth: '2016-05-01', sexAtBirth: 'male', ageYears: 9, ageMonths: 112 },
      latestWeight: null,
      codeStatus: null,
      dangerReactions: [],
      activeConditions: [],
      protocolFiredReason: null,
    },
    body: { episode: null, events: [], activeSchedules: [], priorEpisodes: [], atypicalAdvisories: [] },
  },
  frozenAt: 1700000000,
  expiresAt: 1700100000,
};

describe('SharedBriefPage', () => {
  let apiMock: any;

  async function render(token = 'tok123') {
    await TestBed.configureTestingModule({
      imports: [SharedBriefPage],
      providers: [
        { provide: ApiClientService, useValue: apiMock },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['token', token]]) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SharedBriefPage);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    apiMock = { get: jest.fn() };
  });

  it('loads and renders the frozen snapshot', async () => {
    apiMock.get.mockReturnValue(of(baseSnapshot));
    const fixture = await render();
    expect(apiMock.get).toHaveBeenCalledWith('/er-brief/shared/tok123');
    expect(fixture.componentInstance.snapshot()?.payload.header.patient.fullName).toBe('Milo M5');
    expect(fixture.componentInstance.notFound()).toBe(false);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Milo M5');
    expect(text).toContain('No weight on file');
    expect(text).toContain('NOT SET');
  });

  it('shows a plain not-found message on 404, with no further detail', async () => {
    apiMock.get.mockReturnValue(throwError(() => ({ status: 404 })));
    const fixture = await render();
    expect(fixture.componentInstance.notFound()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("This link has expired or doesn't exist.");
  });
});

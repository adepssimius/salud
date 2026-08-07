import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RevisionHistoryComponent } from './revision-history.component';
import { ApiClientService } from './api-client.service';

describe('RevisionHistoryComponent', () => {
  let apiMock: any;

  beforeEach(async () => {
    apiMock = { get: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [RevisionHistoryComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  it('renders nothing when there are no revisions', () => {
    apiMock.get.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(RevisionHistoryComponent);
    fixture.componentRef.setInput('entityType', 'patient');
    fixture.componentRef.setInput('entityId', 'p1');
    fixture.detectChanges();
    expect(apiMock.get).toHaveBeenCalledWith('/patients/p1/revisions');
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('shows the edited marker and expands to list snapshots', () => {
    apiMock.get.mockReturnValue(
      of([
        { id: 'r2', entityType: 'condition', entityId: 'c1', snapshot: { name: 'old name' }, editedByUserId: 'u1', editedAt: 1700005000 },
        { id: 'r1', entityType: 'condition', entityId: 'c1', snapshot: { name: 'older name' }, editedByUserId: 'u1', editedAt: 1700000000 },
      ]),
    );
    const fixture = TestBed.createComponent(RevisionHistoryComponent);
    fixture.componentRef.setInput('entityType', 'condition');
    fixture.componentRef.setInput('entityId', 'c1');
    fixture.detectChanges();

    expect(apiMock.get).toHaveBeenCalledWith('/conditions/c1/revisions');
    expect(fixture.nativeElement.textContent).toContain('edited 2 times');
    expect(fixture.componentInstance.expanded()).toBe(false);

    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('old name');
    expect(fixture.nativeElement.textContent).toContain('older name');
  });
});

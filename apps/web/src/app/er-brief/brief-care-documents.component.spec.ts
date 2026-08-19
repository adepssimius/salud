import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CareDocumentStatement, CareDocumentsMap } from '@salud/shared/types';
import { ApiClientService } from '../core/api-client.service';
import { BriefCareDocumentsComponent } from './brief-care-documents.component';

function statement(over: Partial<CareDocumentStatement> = {}): CareDocumentStatement {
  return {
    id: 'cd1',
    kind: 'medical_poa',
    status: 'on_file',
    fileId: 'file-1',
    originalName: 'poa.pdf',
    contentType: 'application/pdf',
    holderName: null,
    holderPhone: null,
    setByUserId: 'u1',
    setByName: 'Dana',
    setAt: 1700000000,
    ...over,
  };
}

describe('BriefCareDocumentsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BriefCareDocumentsComponent],
      providers: [{ provide: ApiClientService, useValue: { getBlob: jest.fn(() => of(new Blob())) } }],
    }).compileComponents();
  });

  function render(documents: CareDocumentsMap | null, frozenAt: number | null = null, token: string | null = null) {
    const fixture = TestBed.createComponent(BriefCareDocumentsComponent);
    fixture.componentInstance.documents = documents;
    fixture.componentInstance.frozenAt = frozenAt;
    fixture.componentInstance.shareToken = token;
    fixture.detectChanges();
    return fixture;
  }

  const empty: CareDocumentsMap = { livingWill: null, advanceDirective: null, medicalPoa: null };

  // The whole point of the tri-state: an unrecorded kind says so, rather than being omitted (which
  // a reader would take as "none") or left blank (which is ambiguous).
  it('renders all three kinds as "not recorded" when nothing has been recorded', () => {
    const text = render(empty).nativeElement.textContent;
    expect(text).toContain('Living will');
    expect(text).toContain('Advance directive');
    expect(text).toContain('Medical POA');
    expect(text.match(/not recorded/g)?.length).toBe(3);
  });

  it('distinguishes an affirmative "none" from an unrecorded kind, and attributes it', () => {
    const fixture = render({
      ...empty,
      advanceDirective: statement({ kind: 'advance_directive', status: 'none', fileId: null, originalName: null }),
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('none');
    expect(text).toContain('stated by Dana');
    // The other two are still unrecorded — recording one says nothing about the others.
    expect(text.match(/not recorded/g)?.length).toBe(2);
  });

  it('renders an on-file document as an openable link with its filename', () => {
    const fixture = render({ ...empty, medicalPoa: statement() });
    expect(fixture.nativeElement.textContent).toContain('poa.pdf');
    expect(fixture.nativeElement.textContent).toContain('uploaded by Dana');
  });

  it('shows the PoA holder, who is what triage actually calls', () => {
    const fixture = render({
      ...empty,
      medicalPoa: statement({ holderName: 'Aunt Ada', holderPhone: '555-0100' }),
    });
    expect(fixture.nativeElement.textContent).toContain('Aunt Ada · 555-0100');
  });

  // Unconditional on a frozen copy: a warning that only appeared "when superseded" would make its
  // own silence a promise of currency the app cannot make.
  it('carries the may-have-been-superseded caveat on every line of a frozen snapshot', () => {
    const fixture = render({ ...empty, medicalPoa: statement() }, 1700000000, 'tok');
    const text = fixture.nativeElement.textContent;
    expect(text.match(/may have been superseded/g)?.length).toBe(3);
    expect(text).toContain('ask the family for a current link');
  });

  it('omits the caveat on the live page, which is current by definition', () => {
    const fixture = render({ ...empty, medicalPoa: statement() });
    expect(fixture.nativeElement.textContent).not.toContain('may have been superseded');
  });

  // A shared reader has no account, so the file must come through the snapshot's own token route.
  it('routes file fetches through the token when rendering a shared snapshot', () => {
    const fixture = render({ ...empty, medicalPoa: statement() }, 1700000000, 'tok123');
    expect(fixture.componentInstance.filePathFor(statement())).toBe(
      '/er-brief/shared/tok123/files/file-1',
    );
  });

  it('uses the authenticated files route when there is no token', () => {
    const fixture = render({ ...empty, medicalPoa: statement() });
    expect(fixture.componentInstance.filePathFor(statement())).toBeNull();
  });

  // Snapshots frozen before care documents existed carry no map at all; they are genuinely
  // unrecorded rather than broken, and the link must stay readable.
  it('treats a missing map as three unrecorded kinds', () => {
    const text = render(null).nativeElement.textContent;
    expect(text.match(/not recorded/g)?.length).toBe(3);
  });
});

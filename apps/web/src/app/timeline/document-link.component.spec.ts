import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClientService } from '../core/api-client.service';
import { DocumentLinkComponent } from './document-link.component';

describe('DocumentLinkComponent', () => {
  let apiMock: any;
  let openSpy: jest.SpyInstance;

  beforeEach(async () => {
    apiMock = { getBlob: jest.fn(() => of(new Blob(['pdf']))) };
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    (URL as any).createObjectURL = jest.fn(() => 'blob:doc');
    (URL as any).revokeObjectURL = jest.fn();

    await TestBed.configureTestingModule({
      imports: [DocumentLinkComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  afterEach(() => openSpy.mockRestore());

  function render() {
    const fixture = TestBed.createComponent(DocumentLinkComponent);
    fixture.componentInstance.fileId = 'f1';
    fixture.componentInstance.label = 'Discharge summary';
    fixture.detectChanges();
    return fixture;
  }

  // Lazy on purpose: a day with four attached documents must not pull four blobs nobody opened.
  it('renders the label without fetching anything until it is clicked', () => {
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Discharge summary');
    expect(apiMock.getBlob).not.toHaveBeenCalled();
  });

  it('fetches through the authenticated client and opens the blob', () => {
    const fixture = render();
    fixture.nativeElement.querySelector('.doc-link').dispatchEvent(new MouseEvent('click'));
    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f1');
    expect(openSpy).toHaveBeenCalledWith('blob:doc', '_blank', 'noopener');
  });

  it('reuses the object URL on a second open rather than refetching', () => {
    const fixture = render();
    fixture.componentInstance.open();
    fixture.componentInstance.open();
    expect(apiMock.getBlob).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('says so when the file cannot be fetched', () => {
    apiMock.getBlob.mockReturnValue(throwError(() => ({ status: 404 })));
    const fixture = render();
    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(fixture.componentInstance.failed()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("Couldn't open that attachment.");
  });

  it('revokes the object URL on destroy', () => {
    const fixture = render();
    fixture.componentInstance.open();
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:doc');
  });
});

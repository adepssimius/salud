import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PhotoThumbnailComponent } from './photo-thumbnail.component';
import { ApiClientService } from './api-client.service';

describe('PhotoThumbnailComponent', () => {
  let apiMock: any;
  const fakeUrl = 'blob:http://localhost/fake';

  beforeEach(async () => {
    apiMock = { getBlob: jest.fn() };
    (URL as any).createObjectURL = jest.fn().mockReturnValue(fakeUrl);
    (URL as any).revokeObjectURL = jest.fn();

    await TestBed.configureTestingModule({
      imports: [PhotoThumbnailComponent],
      providers: [{ provide: ApiClientService, useValue: apiMock }],
    }).compileComponents();
  });

  it('fetches the file as a blob and renders it as an image', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    apiMock.getBlob.mockReturnValue(of(blob));

    const fixture = TestBed.createComponent(PhotoThumbnailComponent);
    fixture.componentRef.setInput('fileId', 'f1');
    fixture.detectChanges();

    expect(apiMock.getBlob).toHaveBeenCalledWith('/files/f1');
    const img = fixture.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe(fakeUrl);
  });

  it('renders nothing when the fetch fails', () => {
    apiMock.getBlob.mockReturnValue(throwError(() => new Error('nope')));

    const fixture = TestBed.createComponent(PhotoThumbnailComponent);
    fixture.componentRef.setInput('fileId', 'f1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
});

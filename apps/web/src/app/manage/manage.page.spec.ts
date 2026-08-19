import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ManagePage } from './manage.page';

describe('ManagePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManagePage],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  // The point of this page is that these three actions exist somewhere off Home, and that their
  // destinations are unchanged — moving them must not also rewire them.
  it('links to the catalogs and the new-schedule form', () => {
    const fixture = TestBed.createComponent(ManagePage);
    fixture.detectChanges();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links.map((a) => [a.textContent!.trim(), a.getAttribute('href')])).toEqual([
      ['Medication catalog', '/medications'],
      ['Analyte catalog', '/analytes'],
      ['New schedule', '/schedules/new'],
    ]);
  });
});

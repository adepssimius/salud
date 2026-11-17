import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteReuseStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { REBUILD_ON_PARAM_CHANGE, SaludRouteReuseStrategy } from './route-reuse.strategy';

let instances = 0;

@Component({ standalone: true, template: 'page' })
class CountingPage {
  constructor() {
    instances++;
  }
}

describe('SaludRouteReuseStrategy', () => {
  beforeEach(() => {
    instances = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'form', component: CountingPage, data: { [REBUILD_ON_PARAM_CHANGE]: true } },
          { path: 'thing/:id', component: CountingPage, data: { [REBUILD_ON_PARAM_CHANGE]: true } },
          { path: 'plain', component: CountingPage },
        ]),
        { provide: RouteReuseStrategy, useExisting: SaludRouteReuseStrategy },
      ],
    });
  });

  it('rebuilds a flagged page when Quick log re-enters it for another patient', async () => {
    // The bug: /observations/new?patientId=A → Quick log → B reused the form, still "For A".
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/form?patientId=a&compact=1');
    await harness.navigateByUrl('/form?patientId=b&compact=1');
    expect(instances).toBe(2);
  });

  it('rebuilds a flagged page when a path param changes', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/thing/1');
    await harness.navigateByUrl('/thing/2');
    expect(instances).toBe(2);
  });

  it('still reuses a flagged page when nothing about its params changed', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/form?patientId=a');
    await harness.navigateByUrl('/form?patientId=a');
    expect(instances).toBe(1);
  });

  it('leaves unflagged routes on Angular\'s default reuse', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plain?x=1');
    await harness.navigateByUrl('/plain?x=2');
    expect(instances).toBe(1);
  });
});

import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, Params } from '@angular/router';

/**
 * Route `data` flag: rebuild this page, instead of reusing it, when its params or query params change.
 *
 * Angular reuses the component whenever the route config is the same, which is right for a page
 * that follows its params reactively and wrong for one that reads them once in ngOnInit. The entry
 * forms are the second kind, and they are reachable in place: Quick log opened from
 * `/observations/new?patientId=A` and pointed at patient B navigates to
 * `/observations/new?patientId=B`, and the reused form went on saying "For A" — with A's episodes
 * offered — under B's URL, right after the caregiver had picked B (frontend.md → "Patient
 * identity"). A fresh form is also the honest outcome: the caregiver just asked for a new entry.
 */
export const REBUILD_ON_PARAM_CHANGE = 'rebuildOnParamChange';

@Injectable({ providedIn: 'root' })
export class SaludRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (!super.shouldReuseRoute(future, curr)) return false;
    if (!future.routeConfig?.data?.[REBUILD_ON_PARAM_CHANGE]) return true;
    return sameParams(future.params, curr.params) && sameParams(future.queryParams, curr.queryParams);
  }
}

function sameParams(a: Params, b: Params): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => String(a[k]) === String(b[k]));
}

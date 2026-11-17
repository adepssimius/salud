import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CatalogSeedApplyResult, CatalogSeedPreview } from '@salud/shared/types';
import { DatabaseService } from '../../persistence/database.service';
import { CatalogFile, CatalogFileError, parseCatalogFile } from './catalog-file';
import { applyCatalogSelection, loadCatalogState, reconcileCatalog } from './catalog-reconcile';
import {
  CatalogSource,
  CatalogSourceNotConfigured,
  CatalogSourceUnavailable,
  fetchCatalogSource,
} from './catalog-source';

/**
 * "Check repo catalog" (api.md → "Repo catalog"). Stateless on purpose: nothing about a preview is
 * remembered between the two requests. With two api replicas and no session affinity the apply can
 * land on the other pod, so the preview's identity travels with the client as `sourceHash` and the
 * apply re-fetches and re-reconciles rather than trusting anything computed earlier.
 */
@Injectable()
export class CatalogSeedService {
  private readonly logger = new Logger(CatalogSeedService.name);

  // Serialises applies *within this process*, so two clicks landing on the same pod reconcile one
  // after the other and the second sees what the first added. It holds no data and nothing
  // depends on it across requests; two pods applying in the same instant can still both add a
  // medication — the gap api.md → "Repo catalog" documents and accepts.
  private applyChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseService) {}

  private async load(): Promise<{ source: CatalogSource; file: CatalogFile }> {
    let source: CatalogSource;
    try {
      source = await fetchCatalogSource();
    } catch (err) {
      if (err instanceof CatalogSourceNotConfigured) throw new ServiceUnavailableException('CATALOG_SEED_NOT_CONFIGURED');
      // The detail is for the operator, not the caregiver: it names hosts and status codes.
      this.logger.warn(`Repo catalog unavailable: ${(err as Error).message}`);
      if (err instanceof CatalogSourceUnavailable) throw new BadGatewayException('CATALOG_SEED_UNAVAILABLE');
      throw err;
    }
    try {
      return { source, file: parseCatalogFile(source.text) };
    } catch (err) {
      if (err instanceof CatalogFileError) {
        this.logger.warn(`Repo catalog at ${source.url} is invalid: ${err.problems.join('; ')}`);
        throw new BadGatewayException('CATALOG_SEED_INVALID');
      }
      throw err;
    }
  }

  async preview(): Promise<CatalogSeedPreview> {
    const { source, file } = await this.load();
    const rec = reconcileCatalog(file, await loadCatalogState(this.db.db as any));
    return {
      sourceUrl: source.url,
      sourceHash: source.hash,
      fetchedAt: Math.floor(Date.now() / 1000),
      newMedications: rec.newMedications,
      newEmbodiments: rec.newEmbodiments,
      newGuidelines: rec.newGuidelines,
      present: rec.present,
    };
  }

  apply(sourceHash: string, select: string[]): Promise<CatalogSeedApplyResult> {
    const run = this.applyChain.then(() => this.applyNow(sourceHash, select));
    this.applyChain = run.catch(() => undefined);
    return run;
  }

  private async applyNow(sourceHash: string, select: string[]): Promise<CatalogSeedApplyResult> {
    const { source, file } = await this.load();
    // A confirmation means "add what I was shown", not whatever main holds a minute later.
    if (source.hash !== sourceHash) throw new ConflictException('CATALOG_SEED_CHANGED');
    const rec = reconcileCatalog(file, await loadCatalogState(this.db.db as any));
    const result = await applyCatalogSelection((fn) => this.db.withTransaction(fn), rec, select);
    if (result.added.length) {
      this.logger.log(`Repo catalog applied from ${source.url}: added ${result.added.join(', ')}`);
    }
    return result;
  }
}

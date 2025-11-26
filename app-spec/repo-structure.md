# Repo Structure (Nx Monorepo)

## Project Layout

- Use Nx to manage a monorepo with separate projects.
- API: NestJS app (e.g., `apps/api`), with its own unit/integration test targets.
- UI: Angular app (e.g., `apps/web`), with its own component/e2e test targets.
- Keep test suites as dedicated Nx projects where helpful (e.g., `apps/api-e2e`, `apps/web-e2e`).
- Shared code lives in `libs/` (types, utilities, UI components).
- Tooling (lint, format, test, build, serve) should be wired as Nx targets per project.
- Yarn is the package manager for the workspace (use the version set in `.tool-versions`).
- The repo mandates `asdf` for tool management so Node/Yarn versions from `.tool-versions` are automatically picked up.

## Shared Libraries (`libs/`)

Shared libraries enable type safety and code reuse across API and UI. All shared code must be framework-agnostic (no NestJS decorators, no Angular-specific code in shared type definitions).

### Library Organization

#### `libs/shared/types`
- **Purpose**: Shared TypeScript interfaces, types, and enums used by both API and UI.
- **What belongs here**:
  - DTOs (Data Transfer Objects) for API requests/responses
  - Domain model interfaces (User, Patient, Observation, etc.)
  - Enums (TempUnit, WeightUnit, SexAtBirth, ObservationType, etc.)
  - API response wrapper types
  - Validation schemas (plain objects/types, not decorated classes)
- **What does NOT belong here**:
  - NestJS-specific decorators (`@Injectable`, `@Controller`, etc.)
  - Angular-specific code (`@Component`, `@Directive`, etc.)
  - Implementation logic (services, controllers, components)
  - Framework-specific validation decorators (use plain types; decorators stay in apps)

#### `libs/shared/validators` (optional, for future use)
- **Purpose**: Shared validation logic that works on both client and server.
- **What belongs here**:
  - Pure functions for validation (e.g., `isValidDose()`, `calculateNextAllowedTime()`)
  - Validation rule definitions as plain objects
  - Business logic that needs to run on both client and server

#### `libs/ui/components` (UI-specific shared components)
- **Purpose**: Reusable Angular components shared across UI apps.
- **What belongs here**:
  - Common UI components (buttons, forms, layouts)
  - Angular-specific utilities

### Type Sharing Rules

#### When to share types
- **Always share**:
  - All API request/response DTOs
  - Domain model interfaces
  - Enums used in API contracts
  - Error code types
  - Query parameter types
- **Never share**:
  - Database entities (stay in `apps/api`)
  - Framework-specific decorated classes (stay in their respective apps)
  - App-specific state management types

#### How to implement type sharing
1. **Define pure types in `libs/shared/types`**:
   - Export interfaces/types/enums without decorators
   - Use plain TypeScript types (no `class-validator`, no `class-transformer` decorators)
   
2. **Create decorated classes in apps**:
   - **API**: Import types from `libs/shared/types`, create NestJS DTOs that implement those interfaces
   - **UI**: Import types directly from `libs/shared/types`, use in Angular services/components

#### Example pattern

```typescript
// libs/shared/types/src/lib/dtos/register.dto.ts
export interface RegisterDto {
  email: string;
  password: string;
  displayName: string;
  preferredTempUnit?: 'C' | 'F';
  preferredLengthUnit?: 'cm' | 'in';
  preferredWeightUnit?: 'kg' | 'lb' | 'st';
}

// apps/api/src/app/auth/dto/register.dto.ts
import { RegisterDto as IRegisterDto } from '@salud/shared/types';
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class RegisterDto implements IRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
  
  @IsString()
  @MinLength(1)
  displayName!: string;
  
  @IsOptional()
  @IsIn(['C', 'F'])
  preferredTempUnit?: 'C' | 'F';
  
  // ... etc
}

// apps/web/src/app/services/auth.service.ts
import { RegisterDto } from '@salud/shared/types';

registerUser(data: RegisterDto): Observable<AuthResponse> {
  return this.http.post<AuthResponse>('/api/auth/register', data);
}
```

### Naming Conventions

- Library names: `@salud/shared/types`, `@salud/shared/validators`, `@salud/ui/components`
- File names: kebab-case (e.g., `register.dto.ts`, `patient.interface.ts`)
- Type/interface exports: PascalCase (e.g., `RegisterDto`, `PatientInterface`)
- Enums: PascalCase with uppercase values (e.g., `TempUnit.C`, `TempUnit.F`)

### Import Paths

Configure TypeScript path mappings in `tsconfig.base.json`:
```json
{
  "paths": {
    "@salud/shared/types": ["libs/shared/types/src/index.ts"],
    "@salud/shared/validators": ["libs/shared/validators/src/index.ts"],
    "@salud/ui/components": ["libs/ui/components/src/index.ts"]
  }
}
```

Use these paths consistently:
- ✅ `import { RegisterDto } from '@salud/shared/types';`
- ❌ `import { RegisterDto } from '../../../libs/shared/types/src/lib/dtos/register.dto';`

### Library Creation

Use Nx generators to create shared libraries:
```bash
# Create shared types library
nx g @nx/js:library shared/types --directory=libs/shared/types --buildable --publishable=false

# Create shared validators library (future)
nx g @nx/js:library shared/validators --directory=libs/shared/validators --buildable --publishable=false

# Create UI components library (Angular-specific)
nx g @nx/angular:library ui/components --directory=libs/ui/components
```

### Migration Strategy

When adding new API endpoints or modifying existing ones:
1. Define/update the interface in `libs/shared/types` first
2. Create/update the decorated DTO class in `apps/api` that implements the shared interface
3. Use the shared type in `apps/web` services
4. Both API and UI will fail to compile if types diverge, ensuring type safety

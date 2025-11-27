import { CareTeamRole, LoginDto, RegisterDto, TempUnit } from './types';

describe('shared types', () => {
  it('exports enums and DTO shapes', () => {
    const temp: TempUnit = 'C';
    const role: CareTeamRole = 'parent';
    const reg: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      displayName: 'Tester',
      preferredTempUnit: temp,
    };
    const login: LoginDto = { email: reg.email, password: reg.password };
    expect(role).toBeDefined();
    expect(login.email).toBe('test@example.com');
  });
});

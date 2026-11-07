export type UserRole =
  | 'Super Admin'
  | 'Administrator'
  | 'Accountant'
  | 'Salesman'
  | 'Purchase Operator'
  | 'Viewer';

export type UserStatus = 'Active' | 'Inactive' | 'Suspended';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until?: string | null;
  last_login?: string | null;
  last_login_ip?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModulePermission {
  module_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface AuthStatusResponse {
  success?: boolean;
  initialized: boolean;
  needsSetup?: boolean;
  userCount: number;
  authenticated: boolean;
  user?: User | null;
  permissions?: Record<string, ModulePermission> | null;
  message?: string;
  error?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  expiresAt?: string;
  user?: User;
  permissions?: Record<string, ModulePermission>;
  error?: string;
  locked?: boolean;
  remainingMinutes?: number;
  attemptsRemaining?: number;
}

export interface AuditLog {
  id: number;
  user_id?: number | null;
  username: string;
  action: string;
  status: 'SUCCESS' | 'FAILED' | 'WARNING' | 'INFO';
  ip_address?: string | null;
  user_agent?: string | null;
  details?: string | null;
  created_at: string;
}

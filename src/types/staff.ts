export type StaffRole = 'admin' | 'staff';
export type StaffStatus = 'pending' | 'active' | 'suspended';

export interface StaffMe {
  email: string;
  displayName: string;
  role: StaffRole;
  staffStatus: StaffStatus;
}

export interface StaffMeSuccess {
  status: 'success';
  item: StaffMe;
}

export interface StaffMeError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED';
}

// Phase5C: 管理画面用

export interface StaffRosterItem {
  email: string;
  displayName: string;
  role: StaffRole;
  status: StaffStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  lastSeenAt: string | null;
}

export interface StaffRosterSuccess {
  status: 'success';
  items: StaffRosterItem[];
}

export interface StaffApproveePayload {
  email: string;
  displayName: string;
  role: StaffRole;
}

export interface StaffUpdatePayload {
  email: string;
  displayName: string;
}

export interface StaffRolePayload {
  email: string;
  role: StaffRole;
}

export interface StaffEmailPayload {
  email: string;
}

export interface StaffActionSuccess {
  status: 'success';
}

export interface StaffAdminError {
  status: 'error';
  message: string;
  code?: 'AUTH_INVALID' | 'STAFF_NOT_FOUND' | 'STAFF_PENDING' | 'STAFF_SUSPENDED' | 'FORBIDDEN_ROLE'
    | 'CANNOT_DEMOTE_SELF' | 'CANNOT_SUSPEND_SELF';
}

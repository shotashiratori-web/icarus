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

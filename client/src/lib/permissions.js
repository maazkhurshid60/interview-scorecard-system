/**
 * Permission checks matching the Roles & Permissions Guide.
 * Roles: owner, admin, hiring_manager, recruiter, interviewer.
 */

// Super-admin & Admin operations
export const canDeleteRecords = (user) => user?.role === 'owner' || user?.role === 'admin';
export const canSeeAiSpend = (user) => user?.role === 'owner' || user?.role === 'admin';
export const canListUsers = (user) => user?.role === 'owner' || user?.role === 'admin';
export const canManageUsers = (user) => user?.role === 'owner' || user?.role === 'admin';
export const canViewAuditLog = (user) => user?.role === 'owner' || user?.role === 'admin';
export const canManageSettings = (user) => user?.role === 'owner' || user?.role === 'admin';

// Requisitions / Job Openings: Owner, Admin, Hiring Manager, Recruiter
export const canManageRequisitions = (user) => ['owner', 'admin', 'hiring_manager', 'recruiter'].includes(user?.role);

// Pipelines & Stages: Owner, Admin, Hiring Manager
export const canManagePipelines = (user) => ['owner', 'admin', 'hiring_manager'].includes(user?.role);

// Departments: Owner, Admin, Hiring Manager
export const canManageDepartments = (user) => ['owner', 'admin', 'hiring_manager'].includes(user?.role);

// Candidates (Create, Edit, Attach): Owner, Admin, Hiring Manager, Recruiter
export const canManageCandidates = (user) => ['owner', 'admin', 'hiring_manager', 'recruiter'].includes(user?.role);

// Decisions & Dispositions (Move Stage, Reject/Hire, Offer Letters): Owner, Admin, Hiring Manager, Recruiter
export const canMakeDecisions = (user) => ['owner', 'admin', 'hiring_manager', 'recruiter'].includes(user?.role);

// Scorecards & Interviews: All active users (including Interviewers)
export const canConductInterviews = (user) => Boolean(user?.role);

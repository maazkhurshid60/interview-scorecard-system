/**
 * The wording of every email the app sends: one subject and one body each.
 * HR can edit the text here without touching any code that sends the emails.
 *
 * How to edit:
 *  - A word in {braces} is replaced with that person's real detail, for example {name}.
 *    Use only the details listed under `details` for that email. Anything else is rejected
 *    when the server starts, so a typo is caught straight away instead of being emailed out.
 *  - A line that contains a detail we do not have is left out of the email altogether. That is how
 *    "Date and time: {dateTime}" simply disappears when an interview has no time yet.
 *  - Keep a blank line between paragraphs. The emails are plain text.
 */

const SIGN_OFF = `Best regards,
HR Department
Red Star Technologies`;

export default {
  // To the candidate, right after they apply through the public job link.
  applicationReceived: {
    details: ['name', 'jobTitle'],
    subject: 'Application Received – {jobTitle} | RedStar Technologies',
    body: `Dear {name},

Thank you for your interest in joining Red Star Technologies and for applying for the position of {jobTitle}.

We have successfully received your application. Our recruitment team will review your profile, and if your qualifications and experience align with our requirements, we will contact you regarding the next steps in the hiring process.

We appreciate your interest in becoming part of our team and thank you for considering Red Star Technologies as your next career opportunity.

${SIGN_OFF}
hr@redstartechs.com`,
  },

  // To the candidate, when a recruiter asks for their interview availability.
  availabilityRequest: {
    details: ['name', 'jobTitle', 'stage', 'availabilityLink'],
    subject: 'Interview Availability Request – {jobTitle} ({stage})',
    body: `Dear {name},

Thank you for your interest in the {jobTitle} position at Red Star Technologies. We would like to schedule your {stage} interview.

Please use the link below to select the dates and times that suit you best:
{availabilityLink}

Once we receive your availability, we will confirm the interview time with you.

${SIGN_OFF}`,
  },

  // To the candidate, when a meeting link is sent or sent again by hand.
  // (Interviews scheduled through Google Calendar are announced by Google's own invitation instead.)
  interviewLink: {
    details: ['name', 'jobTitle', 'date', 'time', 'meetingLink'],
    subject: 'Interview Invitation – {jobTitle} | RedStar Technologies',
    body: `Dear {name},

We are pleased to invite you for an interview for the position of {jobTitle} at RedStar Technologies.

Interview Date: {date}
Interview Time: {time}
Interview Link: {meetingLink}

Kindly join the meeting on time and ensure your camera, microphone, and internet connection are working properly.

We look forward to speaking with you.

Best regards,
HR Department
RedStar Technologies
hr@redstartechs.com`,
  },

  // To the candidate, when a recruiter sends the offer letter. The PDF is attached in production.
  offerLetterAttached: {
    details: ['name', 'jobTitle'],
    subject: 'Job Offer – {jobTitle} | RedStar Technologies',
    body: `Dear {name},

Congratulations!

We are pleased to offer you the position of {jobTitle} at Red Star Technologies.

Please review your attached offer letter.

Kindly confirm your acceptance.

We look forward to welcoming you to our team.

${SIGN_OFF}
hr@redstartechs.com`,
  },

  // The same email outside production, where the letter is a download link instead of an attachment.
  offerLetterLink: {
    details: ['name', 'jobTitle', 'offerLetterLink'],
    subject: 'Job Offer – {jobTitle} | RedStar Technologies',
    body: `Dear {name},

Congratulations!

We are pleased to offer you the position of {jobTitle} at Red Star Technologies.

Please review your offer letter using the link below:
{offerLetterLink}

Kindly confirm your acceptance.

We look forward to welcoming you to our team.

${SIGN_OFF}
hr@redstartechs.com`,
  },

  // To the candidate, when a recruiter sends the onboarding form.
  onboardingForm: {
    details: ['name', 'onboardingLink'],
    subject: 'Onboarding Form – Red Star Technologies',
    body: `Dear {name},

Welcome to Red Star Technologies!

To complete your onboarding process, kindly fill out the onboarding form using the link below.

Onboarding Form: {onboardingLink}

Please ensure all required information is accurate and submitted before the deadline.

We look forward to having you on our team.

Best regards,
HR Department
RedStar Technologies
hr@redstartechs.com`,
  },

  // To the candidate, when staff cancel a scheduled interview.
  interviewCancelled: {
    details: ['name', 'jobTitle', 'date', 'time'],
    subject: 'Interview Cancelled – {jobTitle} | RedStar Technologies',
    body: `Dear {name},

We regret to inform you that your interview for the position of {jobTitle}, scheduled for {date} at {time}, has been cancelled.

We apologize for any inconvenience and appreciate your understanding.

Best regards,
HR Department
Red Star Technologies
hr@redstartechs.com`,
  },

  // To the HR calendar mailbox, when an interview is scheduled with Google Calendar.
  interviewScheduledNotice: {
    details: ['candidateName', 'jobTitle', 'stage', 'dateTime', 'timeZone', 'duration', 'meetingLink'],
    subject: 'Scheduled: {candidateName} – {stage}',
    body: `Hello,

An interview has been scheduled in your Google Calendar.

Candidate: {candidateName}
Position: {jobTitle}
Interview stage: {stage}
Date and time: {dateTime} ({timeZone})
Duration: {duration}
Google Meet link: {meetingLink}

The candidate has been invited through Google Calendar. Please review the event on your calendar before the interview.

${SIGN_OFF}`,
  },

  // To the HR calendar mailbox, when a scheduled interview is cancelled.
  interviewCancelledNotice: {
    details: ['candidateName', 'jobTitle', 'stage', 'dateTime', 'timeZone'],
    subject: 'Cancelled: {candidateName} – {stage}',
    body: `Hello,

The following interview has been cancelled.

Candidate: {candidateName}
Position: {jobTitle}
Interview stage: {stage}
Previously scheduled: {dateTime} ({timeZone})

The Google Calendar event has been removed and the candidate has been notified.

${SIGN_OFF}`,
  },

  // To a staff member who asked to reset their password.
  passwordReset: {
    details: ['name', 'resetLink', 'minutes'],
    subject: 'Reset your OWNERS TALENT password',
    body: `Dear {name},

We received a request to reset your OWNERS TALENT password.

Choose a new password here (this link expires in {minutes} minutes):
{resetLink}

If you did not request this, you can safely ignore this email.

Best regards,
Red Star Technologies`,
  },
};

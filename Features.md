This document will be used to describe the context and features that I want included within the dental scheduler. For AI agents: please do not edit this document without explicit decision.

Context:
- This goal of this software is to be able to integrate it with dentrix ascend. This would require read and write access that I currently do not have. Therefore all features will need to be simulated with the assumption of having read-write access later on.

Scheduling features:
- Patient should be able to create an account that will line up with their dentrix information. By creating an account we should be able to have full context on the patient and how their previous appointments have been scheduled.
- When the patient logs in they will be able to see if they have a future appointment booked. They should have the ability to cancel/move the appointment to available slots. 
- One of the important parts of scheduling is putting patients with the providers that they previously had. So for instance a patient who has had a certain provider many times will generally prefer to have that provider.
- After a patient has an appointment they should be able to rate their experience out of five stars + add any comments/concerns. This will be used for the practice owner to have metrics on highly preforming hygenists / if there are any issues that they need to address.
- The patient should be able to favorite a provider and see their previous appointments so that they understand who their favorite providers are.
- For more advanced appointments (fillings or crowns) patients have treatment plans within dentrix and usually have to call to book these appointments. I want patients to be able to see their current treatment plans along with the predicted costs for the treatment as comapred to their insurance. Then they should be able to book the treatment plan with the dentist who prescribed it. This is done by essentially looking at the dentist that did the last exam or the dentist that did the exam when the treatment plan was made. Dentists only like to do treatment plans on the patients that they diagonose.
- Another point on the more advanced appointments: Dentists take different time to complete the same procedures based on experience. I want the dentists to be able to set how long they think a certain treatment is going to take and in what way. The program should be able to recommend to the dentist how long it thinks it would take based on data from previous appointments.
- There are multiple ways that the more advanced appointments are done. Sometimes it can be done within one appointment. Sometimes two appointments are necessary and needed to be scheduled multiple hours apart. This is a very complicated process that will need refinement later on.
- Patients should be able to see when they are due for an appointment in the future depending on their insurance (for the vast majority of patients this would be six months + a day from their last appointment)

Other notes:
- I want patients to be able to download this program as an app on the phone and I also want it to be possible to book it from a website.



Questions:

- **Practice scope:** Is this for one dental practice first, or should it support multiple practices and locations?

This will be for one dental practice first for intial development of the product.

- **Account matching:** How will a new account be securely matched to the correct Dentrix patient record, including patients with duplicate or outdated contact details?

That is an issue that I'm not really sure about. One path I was thinking would be to input name + birthdate and then to send a verification code over email (for the patients that have email). Actually maybe phone number would be better because we have all of them on file - so we could send a verification code to the phone number and then the patient has to input the code into the program.

- **Appointment types:** Which routine appointments can patients book themselves, and what information determines available slots, provider eligibility, and appointment length?

I want to make it possible for patients to book any type of appointment. Available slots is determined by what appointments have already been booked. Provider eligibility is usually by day but it is true that sometimes providers take time off. So maybe we make an option on the admin side to set provider eligibility for the next 6 months. Appointment length is determined by several factors. First would be the type of appointment: cleanings take an hour for adults, for kids usually 30 minutes. Fillings are usually an hour to 2 hours, depending on how many fillings there are and what type. Crowns are two hours if it has already been prepared but can sometimes go even longer - for instance 6 hours if there are a lot of crowns that need to be done. Also sometimes it requires two appointments. Second factor is the provider: For instance my mom can do a filling in 30 minutes that may take another provider an hour and a half. So this is a pretty data intensive process and will take a lot of iteration to get right.

- **Changes and cancellations:** What notice periods, restrictions, or staff approvals apply when patients move or cancel an appointment?

Patients should not be able to move an appointment within 24 hours of the appointment. It should be made clear in the software that patients will have to call to cancel or move at that point, mainly to incentivise not doing that. But yeah for major appointments it would be important to notify the provider. We can work this out more as we go to determine what works best for the dentist.

- **Provider continuity:** Is a favorite or previously seen provider a preference, or should the patient be allowed to require that provider even if it means waiting longer?

I think it should be made known to the patient which provider they prefer and then they can filter appointments by when that provider is available.

- **Treatment plan authority:** Which treatment plans are eligible for self booking, and what should happen when the diagnosing dentist is unavailable or no longer at the practice?

We should aim to make every treatment plan eligible for self booking. In the case of the dentist leaving the practice we should give the admin time to determine what to do with the appointment (move to another dentist/cancel the appointment with an explation about why)

- **Cost estimates:** What data produces treatment and insurance estimates, and how should the app explain that the final cost may differ?

This is usually determined by the dentrix software but in theory this could be done separately by comparing the insurance plan they are on to known benefits. This is also pretty complication and requires being able to obtain the information correctly.

- **Complex scheduling:** What are the rules for multi visit treatments, required gaps, appointment sequence, provider and room availability, and dentist overrides?

This is a good question and indeed a complicated one. I don't know the rules exactly because it was pretty rare but I could converse with my mom (who is a dentist) about these rules.

- **Feedback access:** Who can view patient comments and individual ratings, and which performance measures should the owner see?

Just the admin (practice owner) should be able to see patient comments and ratings - patients should be able to view their own ratings.

- **Delivery:** Should the phone experience launch as native iOS and Android apps, or is a mobile friendly web app acceptable initially?

Eventually native is best but a web app is acceptable initially.

- **Integration feasibility:** Which Dentrix Ascend read and write operations will actually be available, and how should the product handle an unavailable integration?

This part I am fully unsure about so I would need you to investigate this for me.


- **Identity:** Is name, birth date, and an SMS code to a phone on file an acceptable account linking flow? Who can access a child's record, and what happens when a phone number is shared or outdated?

Do some research on what the usual practices are for something like this and we can try to imitate it. Keep this as an open question for futher development.

- **Due date:** Should the app use a due date already recorded in Dentrix Ascend when available, then fall back to practice rules? How should it handle insurance limits that differ from the six month example?

This would need further investigation. I will say that it is a universal rule that (for patients with insurance) 6 months + 1 day will always be valid for cleanings assuming they have not already had two appointments in the same calendar year. You should investigate this yourself a bit to figure out what is best.

- **Booking safety:** Which appointment types can be confirmed immediately, and which should be sent to staff for review until duration and resource rules are reliable?

At first we should have cleanings and exams confirmed immediately. However the goal should be for the system to get it right every time.

- **Cancellation:** At exactly 24 hours before the appointment, is online change still allowed? Which treatment appointments require provider notification or approval?

Exactly 24 hours is fine but not less. 

- **Treatment ownership:** If the diagnosing dentist is unavailable temporarily, should the patient wait, choose another dentist, or request admin review?

Request admin review but this is exceedingly rare.

- **Cost display:** What should the app show when an insurance estimate is missing or uncertain, and what wording should explain that a predicted cost may change?

Great quetion we will need t operfect this later. But in general there should always be a disclaimer saying that predicted costs may change and that estimates are not always accurate.

- **Complex visits:** What appointment sequences, minimum gaps, provider and operatory requirements, and override options does the dentist need?

There are many types and to be honest I'm not sure of all of them at the momment. Keep this as an open question.

- **Feedback:** Which provider performance measures are useful to the owner, and should comments be linked to individual appointments in the admin view?

Overall ratings of each of the providers - yes comments should be linked to individual appointments.

- Should routine appointments book immediately while complex treatments go to staff for review at first?

Yes routine appointments should book immediately, at first complex treatments should go to staff for review.

- If several family members share the phone number on file, how should a patient select and verify the correct record?

In this case the patient would still be verified so they should be able to select themselves and also plan appointments for the other family members.

- When the app cannot get a reliable insurance estimate, should it show the treatment plan without a cost, or require the patient to call before booking?

We need to figure out a way to get a reliable insurance estimate - this program cannot be published until we figure it out. If there is no way then we should never show the cost. However the dentrix ascend program usally calculates it for you

- Can a custom app built for one practice obtain Ascend API access? What approval, security requirements, fees, and expected timeline apply?

I'm building for one practice intially but I would want to expand this software to many practices

For other dentrix questions see if you can evaluate the answers yourself first using online information

- What information on file can reliably distinguish two patients with the same name and birth date?

The phone number should be different so in this edge case we could ask a further question essentially saying looks like we have another person with the exact same name and dob which is your phone number

- Who may book for a minor? May someone book for another adult, and how does that adult grant permission?

For a minor the person who may book would be the person who the insurance is attached to or the wife/husband of the person the insurance is attached to. If they want to book for another adult we should have them call in to do so. Keep this as an open question so I can try to think of ways to make this possible with the app.

- When booking for a family member, may the user see that person’s appointment history and treatment costs, or only available times and confirmed appointments?

For children this is fine, for other people show nothing - they should book for themselves.

- How should staff verify someone whose phone number is missing or outdated?

Make an option to try email instead. If neither work this will have to be done manually by calling the practice and taling to someone.

- Which exact cleaning and exam appointment types should book immediately—for example, adult cleaning, child cleaning, new patient exam, and periodic exam?

All of these can book immediately - for new patients they need certain files on record so we should have a way to direct them on how to submit the files before the appointment.

Another thing that I just remembered is that usually patients will have x-rays scheduled depending on when they last had them - so the system should be able to let people know that they are due for x-rays and have the ability to select whether they want them or not.

- For each type, what are the default duration, eligible providers, and required operatories? Does any visit require both a hygienist and dentist?

Cleaning default duration is an hour and an hour and a half for new patients. Eligible providers and required operatories will need to be done manually at first but there may be a way to do this with the program assuming enough data. Yes cleanings usually require both a hygenist and dentist because the dentist has to do the exam. However this is usually not a problem, unless a patient will only let a certain dentist do the exam.

- Where does the practice currently record provider hours, time off, and blocked time? Which system should staff update?

So the way this is usually done is by putting a repeating block reminder and the top of the schedule to remind staff which provider is avaiable when. The way the program should allow for the input of information is the following: For each provider the dentist should be able to select what days they are avaiable and then go through and click off days that the provider is not. The way I imagine this visually is by looking at a schedule for the month. Each provider has a different color that can be clicked on and off. The admin can edit the schedule, click boxes to turn on or off the colors of availability and then click save. To initially set the provider schedule there should be a section where you can select repeating days.

- What should happen if a slot becomes unavailable between the patient selecting it and confirming it?

When the patient has selected the slot it should be held on the screen so that it is known what is happeing.

- What does the practice’s current Ascend online scheduler already handle well, and what scheduling problems does it leave unsolved? (Ascend online booking)

The problems left unsolved are being solved together right now. I worked as a receptionists at my mothers dental practice where she works as a dentist and manager. I have a pretty good idea of the problems needed to be solved.

## Changelog

For every future user prompt that changes this website's design or features, append the complete prompt verbatim here and translate its requirements into `spec.md`. Preserve the original wording, including spelling and punctuation.

### 2026-11-16 — Patient overview, recare, feedback, and treatment layout

```text
Okay I want to make a few edits here, I'll write my directions here but I want you to add a changelog at the bottom of features.md with my exact requests. I want it remembered that anytime I make a request here that changes the design or features on the website, then my prompt should be added to the changelog. You should then transfer over the information to spec.md.

I'll start with the pateint viewing first. For the recare part I want it to be more visual and understanding. So for instance lets say the insurance is delta dental premier. The insurance name should be listed along with a few columns for due dates for each type of procedure (cleaning, exam, each type of x-ray). Then if you click on one of those columns I want a line to appear. On the left side of the line should be a dot with the date of the procedure above the line. On the right side I it should show the due date. And the line should have higher oppacity up to the percentage of time between the last procedure and when it should be completed next. If the line is 100% then that procedure should glow brighter. This would therefore combine the parts for recare and imaging.

I want history and feedback merged with the overview page. So basically the main part (below upcoming visits) should show previous appointments and there should be a box inside the row for the appointment that says (Share feedback). When the box is clicked there should be a dropdown that lets you share the feedback. Each row will have the following (provider name + the procedures done + the rating you gave them + the share feedback). If the share feeback is done then the box for share feedback should go away

I want treatment plans merged into overview under the recare + imaging part
```

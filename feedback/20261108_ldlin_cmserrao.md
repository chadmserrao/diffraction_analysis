# Peer review, systems: where does the time go, and where does everything run?

Course: Stanford University, EE292M, AI-Augmented R&D: Foundations and Practice, Fall 2026.
Form: ee292m_round5. Capstone review: yes. Written 2026-11-09 01:27 UTC by feedback_helper 147bfa0.

## Reviewer information

- SUNet ID: ldlin
- First name: Linda
- Last name: Lin

## Reviewee information

- SUNet ID: cmserrao
- First name: Chad
- Last name: Serrao
- Repository: https://github.com/chadmserrao/diffraction_analysis
- Reviewed commit: a2cb5ba on main

## Environment

- date: Sun Nov  8 17:27:42 PST 2026
- whoami: lindadlin
- uname -a: Darwin Lindas-MacBook-Pro-4.local 23.6.0 Darwin Kernel Version 23.6.0: Wed Jul 31 20:48:52 PDT 2024; root:xnu-10063.141.1.700.5~1/RELEASE_ARM64_T6020 arm64
- repo path: ../diffraction_analysis

## Checklist

Score: 5 of 5

### 1. We have looked at a profile of the capstone's slowest part, and at one change measured before and after that changed no answer.

Verified: yes

Where the time goes, the change, and the ratio:

Currently the slowest part is the ring fit as the blur function has been fixed now, the previous problem was that the direction of data reading meant that there was no context during the analysis. Prior to the change, the blur accounted for 85% of the computation time in the analysis function.

### 2. The README has a drawing of the capstone as a system, and from it I can say where each part runs and how code and data reach it.

Verified: yes

The machines or containers, and how code and data arrive:

Yes, the section on "how the code is organized" clearly details how the data moves through the system and how sections and organized.

### 3. We have named the original copy of the data, and what in the project cannot be rebuilt by a script, and where that is backed up.

Verified: yes

The original, what cannot be rebuilt, and where its copy is:

Everything is backed up to github.

### 4. We have discussed each boundary in the system (between front end and backend, data and database, or services) and whether it is real.

Verified: yes

The boundaries, and which one is not real yet:

The frontend and backend both work directly in the browser, the boundary is the worker function worker.js messages, which is a real boundary.
There is no data/database, images are stored locally, the materials library is only downloaded once when the project is built, settings are also local -- everything is accessed through src/ locally.
The primarily service is serve.py, that can access the live Materials Project is needed. Since the database is accessed through a proxy (serve.py), that is precisely the boundary.

### 5. We have discussed at least one suggestion I made on how this capstone could be improved.

Verified: yes

State the suggestion and what was decided:

(1) When I press clear all marks then press auto-identify, the points don't re-proprogate. 
(2) A little nit-picky, but the sliding bar next to the contrast bar is brightness right? It doesn't have a label on my end.
(3) Is there some way of distinguishing between spots/rings in the image annotations? Right now the labels are a little ambiguous to me, i.e. the color of the labels could be used to correspond to whether the label refers to a ring or a dot, rather than having to search for the color within the image. Perhaps rings could be a color (and different rings can be different shades of that color), etc?

## Attestation

Completed: 5 of 5 checklist items.

All of my answers are true and accurate to the best of my understanding and ability, and I will upload this feedback to the reviewee's repository and verify that it was uploaded.

Signed: Linda Lin

Goal
This take-home project is designed to evaluate your ability to tackle real-world challenges similar to those you would encounter in our engineering roles. Beyond gauging your technical skills, we aim to understand your problem-solving approach, creativity, clarity of documentation, and your ability to articulate your decisions. The solution method for this project is intentionally left open-ended, to give you the room to showcase these facets. We welcome any additions or changes an engineer sees fit for this task — we will factor these initiatives into how we assess the quality of the work and the UX as well.
Estimated Time: You are expected to spend around 6-8 hours, but feel free to go over as you wish.
Introduction
Acme Corp. is negotiating a multi-billion dollar acquisition and wants to conduct due diligence by placing all the relevant documents in a virtual Data Room. A Data Room is an organized repository for securely storing and distributing documents. You can take inspiration from Google Drive, Dropbox, Box, etc., for UI/UX where the Data Room is the top-level folder or drive.
Our goal is to develop a Data Room Software MVP that works well out of the box. We ask that you optimize for (in this order):
User experience and functionality - make sure UX flows are intuitive and easy to use, handle edge cases and error states


Design and polish - make sure the design looks clean, don't include unimplemented features


Code quality and readability


Instructions
Technical Requirements
Build a full-stack Data Room application — a real backend with a real database, working end to end.


Frontend: any React-based framework (we use React / TypeScript / Tailwind / Shadcn)


Backend: Node.js — we use NestJS + PostgreSQL + Prisma, but any Node framework and relational database is fine


File storage: store uploaded files in blob storage of your choice (S3, Supabase Storage, Vercel Blob, etc.).


Authentication is required: social auth (Google) or email/password. A Data Room belongs to its owner and is not visible to other users unless shared.


You can use off-the-shelf boilerplates and AI tools to write code.


Both frontend and backend must be deployed and publicly accessible.


While designing your solution, think of
A data model designed to support the functional requirements and to scale — see the README requirements in Deliverables


Edge cases, ex: uploading files with the same name, deleting a folder that is being viewed by someone it was shared with


Granular react components


Functional Requirements
Below is the main functionality you should build for
Folders:
Create a folder and nest folders in another folder


View folders and their contents, this includes nested files and folders, with breadcrumb navigation


Update the folder name


Delete a folder and its nested folders and files (warn the user what will be deleted)


Files:
Upload files (PDF is enough): multiple files at once, drag-and-drop, per-file progress


View file in UI


Update a file's name (resolve name conflicts within a folder)


Move a file to another folder


Delete a file


Sharing:
Share a Data Room, a folder, or a single file — the recipient gets read-only access to the shared item (including its nested content for a Data Room or folder)


Support two modes: a public link (anyone with the link can view) and a permissioned share (only specific users you granted access can view)


The owner can revoke access


Deliverables
Code files (required): A github repo with your code and a README containing:


Your design decisions and clear setup instructions


A data model / ERD and a short "How it scales" section answering:


How do you compute the total size and item count of a folder including its whole subtree?
What changes when one Data Room holds 100,000 files (listing, pagination, indexes)?
How does sharing extend to per-user roles (viewer/editor) without remodeling?
A note on where and how you used AI while building


Hosted URLs (required): deployed frontend and backend — we recommend Vercel for the frontend


(Optional) For extra credit:
We ask that you time-box your solution and only attempt the below if you have time remaining
Search and filtering by file name across the Data Room


File versioning on name conflicts

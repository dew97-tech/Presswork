export type ProjectOutcome = {
  value: string;
  label: string;
  detail: string;
};

export type Project = {
  name: string;
  description: string;
  highlight: string;
  stack: string[];
  outcomes?: ProjectOutcome[];
  achievements: string[];
  href?: string;
};

export type Promotion = {
  role: string;
  date: string;
};

export type Job = {
  company: string;
  location: string;
  role: string;
  date: string;
  promotions: Promotion[];
  projects: Project[];
};

export const resumeData = {
  personal: {
    name: "David Dew Mallick",
    role: "Intermediate Software Engineer",
    company: "JB Connect Ltd.",
    email: "david.dew.mallick@g.bracu.ac.bd",
    phone: "+880-1836475822",
    github: "https://github.com/dew97-tech",
    linkedin: "https://www.linkedin.com/in/david-dew-mallick/",
    location: "Dhaka, Bangladesh",
  },
  education: [
    {
      institution: "BRAC University",
      location: "Dhaka, Bangladesh",
      degree: "Bachelor of Science in Computer Science and Engineering",
      date: "Aug 2018 - Dec 2022",
      gpa: "3.55/4.00",
    },
    {
      institution: "St. Gregory's High School and College",
      location: "Dhaka, Bangladesh",
      degree: "Higher Secondary Certificate",
      date: "2016 - 2018",
      gpa: "4.00",
    },
    {
      institution: "St. Gregory's High School and College",
      location: "Dhaka, Bangladesh",
      degree: "Secondary School Certificate",
      date: "2006 - 2016",
      gpa: "5.00",
    },
  ],
  experience: [
    {
      company: "JB Connect Ltd.",
      location: "Banani, Dhaka, Bangladesh",
      role: "Intermediate Software Engineer",
      date: "Oct 2024 - Present",
      promotions: [],
      projects: [
        {
          name: "BridgeBooks System",
          description:
            "AI-driven SEO platform for article generation, backlinks, and contact automation.",
          highlight: "cut generation costs by 95%",
          href: "/work/bridgebooks",
          stack: ["Laravel", "React", "AWS"],
          achievements: [
            "Built the AI article generation module from scratch with two teammates over eight weeks.",
            "Moved generation from AWS Lambda to containers, cutting failure rates to 5% in three weeks.",
            "Reworked model API usage to cut generation costs by 95%.",
            "Tuned SQL queries to reduce page load times by 70%.",
            "Built a keyword system that supplies real-time SEO keywords through layered filtering.",
            "Implemented credit-based billing with usage tracking across platform services.",
            "Rebuilt CSV import and export queue jobs on file storage with automatic cleanup to reduce server memory use.",
            "Built a backlink system that gathers links from third-party services, monitors email replies, and handles inbound responses with AWS Route 53.",
          ],
        },
      ],
    },
    {
      company: "technoPLUS IT",
      location: "Adelaide, South Australia (Remote)",
      role: "Full Stack Web Developer",
      date: "Sep 2024 - Mar 2025",
      promotions: [],
      projects: [
        {
          name: "eduKET LMS",
          description:
            "Platform for course administration and learning material management.",
          highlight: "without breaking either",
          stack: ["Laravel", "PHP", "Vue.js"],
          outcomes: [
            {
              value: "3",
              label: "production fixes and features shipped",
              detail:
                "Course upload and course image thumbnail, both fixed after reaching production. UI glitches and a new feature shipped alongside.",
            },
          ],
          achievements: [
            "Built course and class assignment modules with instructor availability validation.",
            "Added instructor material upload with student-facing access.",
            "Changed database tables to support legacy and new features without breaking either.",
            "Fixed a course upload issue that had reached production.",
            "Fixed the course image thumbnail issue.",
            "Fixed UI glitches and shipped a new feature.",
          ],
        },
      ],
    },
    {
      company: "Kandari Technologies",
      location: "Mirpur, Dhaka, Bangladesh",
      role: "Software Engineer",
      date: "Mar 2023 - Sep 2024",
      promotions: [
        {
          role: "Trainee Web Developer",
          date: "Apr 2022 - Mar 2023",
        },
      ],
      projects: [
        {
          name: "Maison Ensemble",
          description:
            "French language learning platform with interactive study tools.",
          highlight: "12 interactive exercises",
          stack: ["Next.js", "MongoDB", "Auth.js"],
          outcomes: [
            {
              value: "12",
              label: "interactive exercises and games shipped",
              detail:
                "Vocabulary and memory practice for Dutch to French, plus video sessions with embedded quizzes.",
            },
          ],
          achievements: [
            "Built 12 interactive exercises and games for Dutch to French vocabulary and memory practice.",
            "Integrated video lessons with embedded quizzes.",
            "Built a progress and achievement system for exercises.",
            "Built a scoreboard and a sound library alongside the video sessions and games.",
          ],
        },
        {
          name: "Augmenta Education",
          description:
            "Classroom management system for student records, scheduling, and payments.",
          highlight: "automatic credit deduction",
          href: "/work/augmenta",
          stack: ["Laravel", "Blade", "PHP"],
          outcomes: [
            {
              value: "4",
              label: "modules delivered",
              detail:
                "Barcode ID cards, schedule-based class assignment, fee slips with credit deduction, and PDF class routines.",
            },
          ],
          achievements: [
            "Designed the student ID card UI and generated cards from live platform data.",
            "Built schedule-based class assignment with dynamic conflict checks so overlapping classes are caught.",
            "Added payment slip issuance tied to student IDs with automatic credit deduction.",
            "Extended the class routine module with PDF generation and download.",
          ],
        },
        {
          name: "KIMS",
          description: "Inventory management system for retail operations.",
          highlight: "core inventory flows",
          stack: ["Laravel", "Blade", "PHP"],
          outcomes: [
            {
              value: "9",
              label: "inventory entity types modelled",
              detail:
                "Products, categories, brands, units, suppliers, purchases, orders, customers, and sales.",
            },
          ],
          achievements: [
            "Built core inventory flows for products, categories, brands, units, suppliers, purchases, orders, customers, and sales.",
          ],
        },
      ],
    },
  ],
  publications: [
    {
      title:
        "SweetCoat-2D: Two-Dimensional Bangla Spelling Correction and Suggestion Using Levenshtein Edit Distance and String Matching Algorithm",
      publisher: "IEEE",
      date: "Aug 2023",
      link: "https://ieeexplore.ieee.org/abstract/document/10191392",
    },
    {
      title:
        "An Efficient Text Preprocessing and Classification Technique for Multilingual and Transliterated Data",
      publisher: "IEEE",
      date: "Mar 2023",
      link: "https://ieeexplore.ieee.org/abstract/document/10054834",
    },
  ],
  awards: [
    {
      title: "Dean's List",
      description: "Named to the Dean's List in multiple semesters at BRAC University.",
    },
    {
      title: "Presentation Award",
      description:
        "Completed the English Presentation Skills course and received the certificate.",
    },
  ],
  skills: {
    languagesAndFrameworks: [
      "JavaScript",
      "React",
      "Next.js",
      "PHP",
      "Laravel",
      "Node.js",
      "Python",
    ],
    databasesAndStorage: ["SQL", "Redis"],
    cloudAndPlatforms: [
      "AWS Lambda",
      "Route 53",
      "S3",
      "ECS / Fargate",
      "EC2",
      "CloudFront",
      "SES",
      "SQS",
      "Vercel",
      "Docker",
    ],
    methodologies: ["Agile", "Scrum"],
  },
};

export const jobs: Job[] = resumeData.experience;

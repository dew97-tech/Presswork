import type { CaseStudy } from "@/data/case-study";

export const bridgeBooksCaseStudy = {
  href: "/work/bridgebooks",
  title: "BridgeBooks System",
  summary:
    "An AI-driven SEO platform for article generation, backlink acquisition, and contact automation.",
  company: "JB Connect Ltd.",
  role: "Intermediate Software Engineer",
  date: "Oct 2024 - Present",
  collaboration:
    "Built the AI article generation module from scratch with two teammates over eight weeks.",
  description:
    "How I helped build BridgeBooks article-generation infrastructure and improved reliability, model API costs, and page performance.",
  ogDescription:
    "Building AI article-generation infrastructure and improving reliability, model API costs, and page performance.",
  results: [
    {
      value: "5%",
      label: "article-generation failure rate",
      detail:
        "Reached within three weeks of moving generation from AWS Lambda to containers.",
    },
    {
      value: "95%",
      label: "lower model API costs",
      detail: "Achieved by reworking how the platform used AI model APIs.",
    },
    {
      value: "70%",
      label: "page-load improvement",
      detail: "Achieved through targeted SQL query tuning.",
    },
  ],
  sections: [
    {
      title: "The work",
      paragraphs: [
        "The generation workload moved from AWS Lambda to containerized deployment. The failure rate reached 5% within three weeks of the change.",
      ],
    },
    {
      title: "Cost and performance",
      paragraphs: [
        "Reworking model API usage reduced generation costs by 95%. SQL query tuning improved page load times by 70%.",
      ],
    },
    {
      title: "Systems around generation",
      workstreams: [
        {
          title: "Content and discovery",
          items: [
            "Built a keyword acquisition system that supplies real-time SEO keywords through layered filtering.",
            "Added WordPress direct publishing and extended the platform to support additional CMS integrations.",
            "Built an image-generation pipeline producing article images in under 40 seconds.",
            "Developed a Japanese-to-English translation pipeline for article content.",
          ],
        },
        {
          title: "Platform operations",
          items: [
            "Implemented credit-based billing with usage tracking across platform services.",
            "Rebuilt CSV import and export queue jobs around file storage and automatic cleanup to reduce server memory use.",
            "Built backlink workflows that gather links from third-party services, monitor email replies, and handle inbound responses with AWS Route 53.",
            "Built a Selenium form-submission system that avoids bot detection and rotates IPs, running 150 concurrent unattended submissions.",
            "Built an end-to-end deployment script that provisions virtual hosts and databases automatically.",
          ],
        },
      ],
    },
  ],
} satisfies CaseStudy;

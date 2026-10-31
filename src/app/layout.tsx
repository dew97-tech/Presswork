import { ThemeProvider } from "@/components/theme-provider";
import { getSiteUrl } from "@/app/lib/site";
import { resumeData } from "@/data/resume";
import type { Metadata, Viewport } from "next";
import { EB_Garamond, Geist_Mono, Inter, Newsreader } from "next/font/google";
import "./globals.css";

const siteUrl = getSiteUrl();
const { personal } = resumeData;

const siteTitle = "David Dew Mallick | Intermediate Software Engineer";
const siteDescription =
  "Portfolio and technical blog of David Dew Mallick, an intermediate software engineer in Dhaka, Bangladesh.";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
  style: ["normal", "italic"],
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  style: ["normal", "italic"],
  variable: "--font-reading",
  subsets: ["latin"],
  display: "swap",
});

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": `${siteUrl}/#person`,
      name: personal.name,
      url: siteUrl,
      jobTitle: personal.role,
      description: siteDescription,
      sameAs: [personal.github, personal.linkedin],
      worksFor: {
        "@type": "Organization",
        name: personal.company,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: personal.name,
      description: siteDescription,
      inLanguage: "en",
      publisher: { "@id": `${siteUrl}/#person` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${siteUrl}/blog?query={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: personal.name,
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/android-chrome-512.png`,
        width: 512,
        height: 512,
      },
      founder: { "@id": `${siteUrl}/#person` },
      sameAs: [personal.github, personal.linkedin],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | David Dew Mallick",
  },
  description: siteDescription,
  keywords: [
    "Intermediate Software Engineer",
    "Next.js",
    "React",
    "PHP",
    "Laravel",
    "Full Stack Developer",
    "Portfolio",
    "David Dew Mallick",
  ],
  authors: [{ name: personal.name }],
  creator: personal.name,
  publisher: personal.name,
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    title: siteTitle,
    description: siteDescription,
    siteName: personal.name,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "David Dew Mallick, Intermediate Software Engineer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    creator: "@dew97_tech",
    images: ["/og.png"],
  },
  verification: {
    google: "PfnsS0haOH5hKybjZAz_cQoqfEi6BmwL-xj0kyl2rNo",
  },
  icons: {
    icon: [
      { url: "/icon.svg?v=3", type: "image/svg+xml" },
      { url: "/favicon.svg?v=3", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon.svg?v=3" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3e9d8" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1512" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${geistMono.variable} ${ebGaramond.variable} ${newsreader.variable} antialiased min-h-screen flex flex-col bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

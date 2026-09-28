import Header from "@/components/Header";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata = {
  title: "Critiq — Static Code Reviewer",
  description:
    "Review source code and public GitHub repositories for bugs, security risks, performance issues, and maintainability problems.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="antialiased">
      <body className="flex min-h-dvh flex-col bg-[#111111] pt-24 sm:pt-32">
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

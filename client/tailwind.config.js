/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        finance: {
          purple: "#534AB7",
          purpleSoft: "#EEEDFE",
          teal: "#1D9E75",
          tealSoft: "#E1F5EE",
          coral: "#D85A30",
          coralSoft: "#FAECE7",
          blue: "#378ADD",
          blueSoft: "#E6F1FB",
          amber: "#BA7517",
          amberSoft: "#FAEEDA",
          green: "#639922",
          greenSoft: "#EAF3DE",
          red: "#E24B4A",
          redSoft: "#FCEBEB",
          gray: "#888780",
          graySoft: "#F1EFE8",
          ink: "#1B1B28",
          cream: "#F7F4ED"
        },
        surface: "#FFFCF7"
      },
      fontFamily: {
        display: ["Georgia", "Cambria", "Times New Roman", "serif"],
        body: ["Trebuchet MS", "Segoe UI", "sans-serif"]
      },
      boxShadow: {
        panel: "0 20px 50px rgba(27, 27, 40, 0.08)"
      }
    }
  },
  plugins: []
};


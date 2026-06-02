import "./Home.css";
import { FileUploader } from "../../sections/FileUploader/FileUploader";

export function Home() {
  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">Tax Document Extractor</h1>
        <p className="home__subtitle">Upload a PDF to extract tax fields automatically</p>
      </header>
      <FileUploader />
    </main>
  );
}

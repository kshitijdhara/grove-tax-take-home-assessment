import "./Home.css";
import { LogoHeader } from "../../components/LogoHeader/LogoHeader";
import { APITester } from "../../sections/APITester/APITester";

export function Home() {
  return (
    <div className="home">
      <LogoHeader />
      <h1>Bun + React</h1>
      <p>
        Edit <code>src/App.tsx</code> and save to test HMR
      </p>
      <APITester />
    </div>
  );
}

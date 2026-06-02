import "./LogoHeader.css";
import bunLogo from "../../assets/logo.svg";
import reactLogo from "../../assets/react.svg";

export function LogoHeader() {
  return (
    <div className="logo-container">
      <img src={bunLogo} alt="Bun Logo" className="logo bun-logo" />
      <img src={reactLogo} alt="React Logo" className="logo react-logo" />
    </div>
  );
}

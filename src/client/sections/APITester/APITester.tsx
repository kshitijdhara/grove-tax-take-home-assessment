import "./APITester.css";
import { useState } from "react";
import { EndpointForm } from "../EndpointForm/EndpointForm";
import { TextArea } from "../../components/TextArea/TextArea";

export function APITester() {
  const [response, setResponse] = useState("");

  const handleSubmit = async (endpoint: string, method: string) => {
    try {
      const url = new URL(endpoint, location.href);
      const res = await fetch(url, { method });
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      setResponse(String(error));
    }
  };

  return (
    <div className="api-tester">
      <EndpointForm onSubmit={handleSubmit} />
      <TextArea value={response} readOnly placeholder="Response will appear here..." />
    </div>
  );
}

import "./EndpointForm.css";
import type { FormEvent } from "react";
import { Button } from "../../components/Button/Button";
import { Select } from "../../components/Select/Select";
import { TextInput } from "../../components/TextInput/TextInput";

const METHOD_OPTIONS = [
  { value: "GET", label: "GET" },
  { value: "PUT", label: "PUT" },
];

interface EndpointFormProps {
  onSubmit: (endpoint: string, method: string) => void;
}

export function EndpointForm({ onSubmit }: EndpointFormProps) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const endpoint = formData.get("endpoint") as string;
    const method = formData.get("method") as string;
    onSubmit(endpoint, method);
  };

  return (
    <form onSubmit={handleSubmit} className="endpoint-form">
      <Select name="method" options={METHOD_OPTIONS} />
      <TextInput name="endpoint" defaultValue="/api/hello" placeholder="/api/hello" />
      <Button type="submit">Send</Button>
    </form>
  );
}

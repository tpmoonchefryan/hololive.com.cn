import { forwardRef } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

const BASE_CLASS = "disabled:cursor-not-allowed";

const ContentFileInput = forwardRef(function ContentFileInput(
  { className = "", ...props },
  ref
) {
  return (
    <input
      {...props}
      ref={ref}
      type="file"
      className={joinClassNames(BASE_CLASS, className)}
    />
  );
});

export default ContentFileInput;

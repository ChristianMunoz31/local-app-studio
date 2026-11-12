import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm];

// The only module that imports the markdown stack (react-markdown, remark-gfm and the
// micromark/mdast tree). Load it through ./Markdown so it stays out of the entry chunk.
export default function MarkdownImpl({ children, ...props }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} {...props}>
      {children}
    </ReactMarkdown>
  );
}

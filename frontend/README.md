# LeafMind Frontend# LeafMind Frontend# Getting Started with Create React App



A React-based frontend for the LeafMind neuromorphic memory system. This interface provides an intuitive way to interact with the hippocampus-inspired backend for creating, managing, and visualizing knowledge connections.



## FeaturesA React-based frontend for the LeafMind neuromorphic memory system. This interface provides an intuitive way to interact with the hippocampus-inspired backend for creating, managing, and visualizing knowledge connections.This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).



### 🗒️ **Note Management**

- Rich text editor for creating and editing notes

- Automatic concept extraction from text content## Features## Available Scripts

- Real-time concept learning via WebSocket

- Tag-based organization system

- Text selection for creating concept annotations

- Auto-save functionality### 🗒️ **Note Management**In the project directory, you can run:



### 🔍 **Memory Recall**- Rich text editor for creating and editing notes

- Advanced search interface with semantic querying

- Configurable recall parameters (depth, relevance, pattern matching)- Automatic concept extraction from text content### `npm start`

- Real-time search results with confidence scores

- Context highlighting and concept mapping- Real-time concept learning via WebSocket

- Temporal and associative filtering options

- Tag-based organization systemRuns the app in the development mode.\

### 🕸️ **Concept Graph Visualization**

- Interactive D3.js-powered force-directed graph- Text selection for creating concept annotationsOpen [http://localhost:3000](http://localhost:3000) to view it in the browser.

- Real-time visualization of concept relationships

- Node and edge interactions with hover effects- Auto-save functionality

- Zoom and pan functionality

- Dynamic graph updates via WebSocketThe page will reload if you make edits.\

- Color-coded nodes by concept strength

### 🔍 **Memory Recall**You will also see any lint errors in the console.

### ✏️ **Document Annotation**

- Text highlighting and annotation system- Advanced search interface with semantic querying

- Multi-colored highlight management

- Concept creation from highlighted text- Configurable recall parameters (depth, relevance, pattern matching)### `npm test`

- Export functionality for annotations

- Integration with concept learning system- Real-time search results with confidence scores



### 🌙 **Dark Mode Support**- Context highlighting and concept mappingLaunches the test runner in the interactive watch mode.\

- Comprehensive dark mode with toggle switch

- System preference detection and manual override- Temporal and associative filtering optionsSee the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

- Persistent theme preferences in localStorage

- Smooth transitions between light and dark themes

- Neural network-inspired dark gradients

- Enhanced accessibility in both modes### 🕸️ **Concept Graph Visualization**### `npm run build`



## Architecture- Interactive D3.js-powered force-directed graph



### Components- Real-time visualization of concept relationshipsBuilds the app for production to the `build` folder.\

- **`App.tsx`** - Main application with tab navigation, WebSocket connection, and dark mode

- **`NoteManager.tsx`** - Note creation/editing interface with concept extraction- Node and edge interactions with hover effectsIt correctly bundles React in production mode and optimizes the build for the best performance.

- **`RecallSearch.tsx`** - Memory search interface with advanced filtering

- **`ConceptGraph.tsx`** - D3.js visualization component for relationship graphs- Zoom and pan functionality

- **`DocumentAnnotation.tsx`** - Text annotation and highlighting system

- **`DarkModeToggle.tsx`** - Theme switching component with smooth animations- Dynamic graph updates via WebSocketThe build is minified and the filenames include the hashes.\



### Services & Context- Color-coded nodes by concept strengthYour app is ready to be deployed!

- **`websocket.ts`** - WebSocket client for real-time communication with Rust backend

- **`types/index.ts`** - Comprehensive TypeScript definitions for all data structures

- **`DarkModeContext.tsx`** - React context for theme management and persistence

### ✏️ **Document Annotation**See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### Styling

- **Tailwind CSS** with custom brain/synapse color schemes- Text highlighting and annotation system

- Neural network-inspired gradients and animations

- Responsive design with mobile-first approach- Multi-colored highlight management### `npm run eject`

- Dark mode with automatic system preference detection

- Concept creation from highlighted text

## Technology Stack

- Export functionality for annotations**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

- **React 18** with TypeScript

- **D3.js v7** for data visualization- Integration with concept learning system

- **Tailwind CSS 3.4** with dark mode support

- **WebSocket API** for real-time communicationIf you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

- **UUID** for unique identifier generation

- **React Highlight Words** for text highlighting## Architecture

- **Heroicons** for consistent iconography

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

## Getting Started

### Components

### Prerequisites

- Node.js 16+ - **`App.tsx`** - Main application with tab navigation and WebSocket connection managementYou don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

- npm or yarn

- Running LeafMind Rust backend with WebSocket support- **`NoteManager.tsx`** - Note creation/editing interface with concept extraction



### Installation- **`RecallSearch.tsx`** - Memory search interface with advanced filtering## Learn More



```bash- **`ConceptGraph.tsx`** - D3.js visualization component for relationship graphs

cd frontend

npm install- **`DocumentAnnotation.tsx`** - Text annotation and highlighting systemYou can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

```



### Development

### ServicesTo learn React, check out the [React documentation](https://reactjs.org/).

```bash

npm start- **`websocket.ts`** - WebSocket client for real-time communication with Rust backend

```- **`types/index.ts`** - Comprehensive TypeScript definitions for all data structures



Opens the development server at `http://localhost:3000`### Styling

- **Tailwind CSS** with custom brain/synapse color schemes

### Production Build- Neural network-inspired gradients and animations

- Responsive design with mobile-first approach

```bash

npm run build## Technology Stack

```

- **React 18** with TypeScript

Generates optimized production build in `build/` directory- **D3.js v7** for data visualization

- **Tailwind CSS 3.4** for styling

### Deployment- **WebSocket API** for real-time communication

- **UUID** for unique identifier generation

```bash- **React Highlight Words** for text highlighting

npm install -g serve

serve -s build## Getting Started

```

### Prerequisites

## Configuration- Node.js 16+ 

- npm or yarn

### WebSocket Connection- Running LeafMind Rust backend with WebSocket support

The frontend connects to the LeafMind backend via WebSocket at `ws://localhost:8080/ws` by default. Update the connection URL in `src/services/websocket.ts` if needed.

### Installation

### Color Schemes

Custom brain-inspired color palettes are defined in `tailwind.config.js`:```bash

- **Brain colors**: Blue gradients representing neural pathwayscd frontend

- **Synapse colors**: Purple gradients representing connectionsnpm install

- **Dark mode**: Enhanced contrast with deeper blues and purples```



### Theme Management### Development

Dark mode preferences are automatically:

- Detected from system settings on first visit```bash

- Stored in localStorage for persistencenpm start

- Applied with smooth CSS transitions```

- Toggled via the header switch button

Opens the development server at `http://localhost:3000`

## Features Overview

### Production Build

### Real-time Communication

- Bidirectional WebSocket communication with Rust backend```bash

- Automatic reconnection handlingnpm run build

- Message queuing during disconnection```

- Connection status indicators

Generates optimized production build in `build/` directory

### Concept Learning

- Automatic concept extraction from note content### Deployment

- User-driven concept creation via text selection

- Association learning between related concepts```bash

- Contextual metadata preservationnpm install -g serve

serve -s build

### Memory Operations```

- Semantic search with configurable parameters

- Pattern-based recall with relevance scoring## Configuration

- Temporal filtering and context weighting

- Multi-dimensional recall queries### WebSocket Connection

The frontend connects to the LeafMind backend via WebSocket at `ws://localhost:8080/ws` by default. Update the connection URL in `src/services/websocket.ts` if needed.

### Graph Visualization

- Force-directed layout with customizable physics### Color Schemes

- Interactive nodes with drag-and-drop functionalityCustom brain-inspired color palettes are defined in `tailwind.config.js`:

- Edge weight visualization with gradient effects- **Brain colors**: Blue gradients representing neural pathways

- Real-time graph updates and node positioning- **Synapse colors**: Purple gradients representing connections



### Dark Mode Implementation## Features Overview

- Class-based dark mode using Tailwind CSS

- React Context for theme state management### Real-time Communication

- Smooth animations and transitions- Bidirectional WebSocket communication with Rust backend

- System preference integration- Automatic reconnection handling

- localStorage persistence- Message queuing during disconnection

- Enhanced accessibility features- Connection status indicators



## Development### Concept Learning

- Automatic concept extraction from note content

### Project Structure- User-driven concept creation via text selection

```- Association learning between related concepts

src/- Contextual metadata preservation

├── components/          # React components

│   ├── App.tsx         # Main application### Memory Operations

│   ├── NoteManager.tsx # Note management- Semantic search with configurable parameters

│   ├── RecallSearch.tsx# Memory search- Pattern-based recall with relevance scoring

│   ├── ConceptGraph.tsx# Graph visualization- Temporal filtering and context weighting

│   ├── DocumentAnnotation.tsx # Text annotation- Multi-dimensional recall queries

│   └── DarkModeToggle.tsx # Theme switcher

├── contexts/           # React contexts### Graph Visualization

│   └── DarkModeContext.tsx # Theme management- Force-directed layout with customizable physics

├── services/           # Business logic- Interactive nodes with drag-and-drop functionality

│   └── websocket.ts    # WebSocket client- Edge weight visualization with gradient effects

├── types/              # TypeScript definitions- Real-time graph updates and node positioning

│   └── index.ts        # Type definitions

└── styles/             # Styling## Development

    └── index.css       # Global styles & dark mode

```### Project Structure

```

### Adding New Featuressrc/

1. Define types in `src/types/index.ts`├── components/          # React components

2. Update WebSocket service if backend communication needed│   ├── App.tsx         # Main application

3. Create React components in `src/components/`│   ├── NoteManager.tsx # Note management

4. Add dark mode styles using Tailwind classes│   ├── RecallSearch.tsx# Memory search

5. Add navigation in `App.tsx` if new tab required│   ├── ConceptGraph.tsx# Graph visualization

│   └── DocumentAnnotation.tsx # Text annotation

### Dark Mode Development├── services/           # Business logic

When adding new components:│   └── websocket.ts    # WebSocket client

1. Use Tailwind's `dark:` prefix for dark mode styles├── types/              # TypeScript definitions

2. Include `transition-colors duration-300` for smooth transitions│   └── index.ts        # Type definitions

3. Test both light and dark themes└── styles/             # Styling

4. Consider accessibility and contrast ratios    └── index.css       # Tailwind imports

5. Update color schemes in `tailwind.config.js` if needed```



### WebSocket Message Protocol### Adding New Features

The frontend communicates with the backend using structured JSON messages:1. Define types in `src/types/index.ts`

2. Update WebSocket service if backend communication needed

```typescript3. Create React components in `src/components/`

// Learn a new concept4. Add navigation in `App.tsx` if new tab required

{

  type: 'learn_concept',### WebSocket Message Protocol

  concept: string,The frontend communicates with the backend using structured JSON messages:

  context?: any

}```typescript

// Learn a new concept

// Search memory{

{  type: 'learn_concept',

  type: 'recall',  concept: string,

  query: string,  context?: any

  parameters: RecallParameters}

}

// Search memory

// Create associations{

{  type: 'recall',

  type: 'associate_concepts',  query: string,

  concept1: string,  parameters: RecallParameters

  concept2: string,}

  strength?: number

}// Create associations

```{

  type: 'associate_concepts',

## Performance Considerations  concept1: string,

  concept2: string,

- **Component Memoization**: Uses React.memo and useCallback for optimal re-rendering  strength?: number

- **WebSocket Optimization**: Message batching and connection pooling}

- **D3.js Performance**: Efficient force simulation with canvas rendering for large graphs```

- **Bundle Optimization**: Code splitting and tree shaking for minimal bundle size

- **Theme Transitions**: Optimized CSS transitions prevent layout thrashing## Performance Considerations



## Accessibility- **Component Memoization**: Uses React.memo and useCallback for optimal re-rendering

- **WebSocket Optimization**: Message batching and connection pooling

- Semantic HTML structure with proper ARIA labels- **D3.js Performance**: Efficient force simulation with canvas rendering for large graphs

- Keyboard navigation support for all interactive elements- **Bundle Optimization**: Code splitting and tree shaking for minimal bundle size

- High contrast color schemes for visual accessibility

- Screen reader compatible with descriptive text## Accessibility

- Dark mode with enhanced contrast ratios

- Focus indicators that work in both themes- Semantic HTML structure with proper ARIA labels

- Keyboard navigation support for all interactive elements

## Browser Compatibility- High contrast color schemes for visual accessibility

- Screen reader compatible with descriptive text

- Modern browsers with ES6+ support

- WebSocket API support required## Browser Compatibility

- Canvas and SVG support for visualizations

- CSS custom properties for theming- Modern browsers with ES6+ support

- Responsive design for mobile and desktop- WebSocket API support required

- Prefers-color-scheme media query support- Canvas and SVG support for visualizations

- Responsive design for mobile and desktop

## Contributing

## Contributing

1. Follow TypeScript strict mode guidelines

2. Use ESLint configuration for code consistency  1. Follow TypeScript strict mode guidelines

3. Add type definitions for all new interfaces2. Use ESLint configuration for code consistency  

4. Include dark mode styles for all new components3. Add type definitions for all new interfaces

5. Test both light and dark themes4. Include unit tests for new components

6. Include unit tests for new components5. Update documentation for new features

7. Update documentation for new features

## License

## License

Part of the LeafMind project - see main repository for license details.
Part of the LeafMind project - see main repository for license details.
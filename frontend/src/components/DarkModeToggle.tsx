import React from 'react';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import { useDarkMode } from '../contexts/DarkModeContext';

const DarkModeToggle: React.FC = () => {
  const { isDarkMode, toggleDarkMode } = useDarkMode();

  return (
    <button
      onClick={toggleDarkMode}
      className={`
        p-2 rounded-lg transition-all duration-300 ease-in-out
        ${isDarkMode 
          ? 'bg-gray-700 hover:bg-gray-600 text-yellow-400' 
          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
        }
        focus:outline-none focus:ring-2 focus:ring-brain-500 focus:ring-offset-2
        ${isDarkMode ? 'focus:ring-offset-gray-800' : 'focus:ring-offset-white'}
      `}
      title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <div className="relative w-6 h-6">
        <SunIcon 
          className={`
            absolute inset-0 w-6 h-6 transition-all duration-300
            ${isDarkMode ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'}
          `}
        />
        <MoonIcon 
          className={`
            absolute inset-0 w-6 h-6 transition-all duration-300
            ${isDarkMode ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75'}
          `}
        />
      </div>
    </button>
  );
};

export default DarkModeToggle;